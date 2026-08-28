import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { StructuredLogger } from "@ethixweb/shared-kernel";
import { APP_LOGGER } from "../../../shared/observability/app-logger.module";
import { setSpanAttributes } from "../../../shared/observability/tracing";
import { AssembleSystemPromptUseCase } from "../../prompt/application/assemble-system-prompt.use-case";
import type { RuntimeContext } from "../../prompt/domain/runtime-context";
import { EVENT_BUS, type EventBusPort } from "../../events/domain/orchestrator-event";
import {
  CORE_API_CLIENT,
  type CoreApiClientPort,
} from "../../tool-broker/domain/ports/core-api-client.port";
import {
  CALL_ADMISSION_PORT,
  type CallAdmissionPort,
} from "../../capacity/domain/call-admission.port";
import {
  CAPACITY_CONFIG_PROVIDER,
  type CapacityConfigProvider,
} from "../../capacity/domain/capacity-config";
import type { Conversation } from "../domain/conversation.entity";
import {
  CONVERSATION_REPOSITORY,
  type ConversationRepository,
} from "../domain/ports/conversation-repository.port";

const UNKNOWN_TO_NUMBER = "unknown";

export interface StartConversationCommand {
  tenantId: string;
  businessId: string;
  callId: string;
  callerAni: string;
  /** The business's own number the call landed on, if known — see StartConversationDto's own comment. */
  toNumber?: string | undefined;
  timezone?: string | undefined;
  /** docs/36 — see StartConversationDto's own comment on how thin/best-effort this signal is. */
  isEmergencyPriority?: boolean | undefined;
}

/**
 * Called by the Voice Runtime when a call connects — the point where
 * docs/03 §1's layered prompt is assembled ONCE for the whole call (not
 * per turn), which is what makes provider-side prompt caching effective
 * per docs/02 §3's latency budget.
 *
 * PRODUCTION-BLOCKER FIX: also the ordering guarantee's enforcement point.
 * `Lead.callId` (core-api) carries a real database foreign key to
 * `calls.id` — before this fix, nothing ever created that row, so a real
 * `createLead` tool call would fail with a Postgres foreign-key violation
 * against a live database (see docs/26's calls-module doc for the full
 * history). `POST /internal/calls` is called here, BLOCKING, before this
 * conversation is ever created — if it fails, conversation start fails
 * too, rather than silently proceeding into a call no `Call` row backs. A
 * duplicate `callId` (a Voice Runtime retry of `POST /conversations`
 * itself) is safe: `StartCallUseCase` is idempotent on `telephonyCallSid`
 * (here, `callId` — the Voice Runtime's own call identifier already IS the
 * natural idempotency key, so no separate telephony SID field was
 * introduced into this deliberately telephony-concept-free contract, see
 * StartConversationDto's own comment).
 *
 * CAPACITY GATE (docs/36): admission is checked FIRST, before even the
 * Call-row creation above — a call that can't be admitted should never
 * reach core-api at all. `reserve()` throws `CapacityExceededError`
 * (429 + Retry-After, DomainExceptionFilter) when neither this tenant's
 * nor the global ceiling has room; the Voice Runtime is expected to play
 * its own short waiting/brochure experience and retry shortly (docs/36 §4)
 * rather than this service ever holding an HTTP request open to simulate
 * "waiting" — a held connection would just move dead-air into a different
 * layer, not remove it. The reservation is released exactly once, in
 * EndConversationUseCase, best-effort — matching the existing pattern for
 * the Call-row close and usage emission in that method.
 */
@Injectable()
export class StartConversationUseCase {
  constructor(
    @Inject(CONVERSATION_REPOSITORY) private readonly repository: ConversationRepository,
    private readonly assembleSystemPrompt: AssembleSystemPromptUseCase,
    @Inject(EVENT_BUS) private readonly eventBus: EventBusPort,
    @Inject(CORE_API_CLIENT) private readonly coreApiClient: CoreApiClientPort,
    @Inject(CALL_ADMISSION_PORT) private readonly callAdmission: CallAdmissionPort,
    @Inject(CAPACITY_CONFIG_PROVIDER) private readonly capacityConfig: CapacityConfigProvider,
    @Inject(APP_LOGGER) private readonly logger: StructuredLogger,
  ) {}

  async execute(command: StartConversationCommand): Promise<Conversation> {
    setSpanAttributes({
      "ethixweb.tenant_id": command.tenantId,
      "ethixweb.business_id": command.businessId,
    });

    const capacity = await this.capacityConfig.getActiveConfig(
      command.tenantId,
      command.businessId,
    );
    let reservationId: string;
    try {
      const reservation = await this.callAdmission.reserve(command.tenantId, command.businessId, {
        maxTenantConcurrentCalls: capacity.maxTenantConcurrentCalls,
        maxGlobalConcurrentCalls: capacity.maxGlobalConcurrentCalls,
        emergencyHeadroomRatio: capacity.emergencyHeadroomRatio,
        isEmergencyPriority: command.isEmergencyPriority ?? false,
      });
      reservationId = reservation.reservationId;
    } catch (error) {
      // docs/36 §11's `capacity_rejections` metric — logged here, the one
      // place both the tenant/global scope (from CapacityExceededError)
      // and the call's identity are both in hand. No metrics backend
      // exists in this codebase to emit to directly (confirmed by audit:
      // no NestJS throttler, no existing metrics client anywhere) — this
      // structured log line is the honest, currently-available substitute;
      // see docs/36 §11 for what a real metrics pipeline would need.
      this.logger.warn("call rejected: capacity exceeded", {
        tenantId: command.tenantId,
        businessId: command.businessId,
        callId: command.callId,
        scope: error instanceof Object && "scope" in error ? String(error.scope) : "unknown",
      });
      throw error;
    }
    this.logger.info("call admitted: capacity reserved", {
      tenantId: command.tenantId,
      businessId: command.businessId,
      callId: command.callId,
      reservationId,
      isEmergencyPriority: command.isEmergencyPriority ?? false,
    });

    // Everything from here on can fail (core-api outage, a rejected duplicate
    // callId, etc.) — if it does, the reservation MUST be released rather
    // than left to expire on its TTL, or a string of transient failures
    // would slowly starve this tenant's/global capacity for no admitted
    // call. Deliberately re-thrown after release, not swallowed: a failed
    // start is still a failed start from the Voice Runtime's perspective.
    try {
      const now = new Date().toISOString();
      await this.coreApiClient.post("/internal/calls", {
        businessId: command.businessId,
        direction: "inbound",
        fromNumber: command.callerAni,
        toNumber: command.toNumber ?? UNKNOWN_TO_NUMBER,
        telephonyCallSid: command.callId,
        startedAt: now,
      });

      const runtimeContext: RuntimeContext = {
        currentTimeIso: now,
        timezone: command.timezone ?? "UTC",
        // Populated by the getBusinessHours/searchCustomer tools once the
        // conversation is under way — honestly `null` here rather than a
        // guessed default, see formatRuntimeContext's own handling.
        businessHours: null,
        callerAni: command.callerAni,
        existingCustomerMatch: null,
      };

      const { systemPrompt, profile } = await this.assembleSystemPrompt.execute(
        command.tenantId,
        command.businessId,
        runtimeContext,
      );

      const conversation = await this.repository.create({
        id: randomUUID(),
        tenantId: command.tenantId,
        businessId: command.businessId,
        callId: command.callId,
        state: "greeting",
        systemPrompt,
        llmModel: profile.llmModel,
        messages: [],
        transcript: [],
        leadId: null,
        capacityReservationId: reservationId,
        startedAt: now,
        endedAt: null,
        endReason: null,
        version: 1,
      });

      return this.publishStarted(conversation, now);
    } catch (error) {
      await this.callAdmission
        .release(command.tenantId, reservationId)
        .catch((releaseError: unknown) => {
          this.logger.warn(
            "failed to release capacity reservation after a failed call start — non-fatal, TTL will reclaim it",
            {
              tenantId: command.tenantId,
              reservationId,
              reason: releaseError instanceof Error ? releaseError.message : String(releaseError),
            },
          );
        });
      throw error;
    }
  }

  private async publishStarted(conversation: Conversation, now: string): Promise<Conversation> {
    await this.eventBus.publish({
      type: "conversation.started",
      tenantId: conversation.tenantId,
      businessId: conversation.businessId,
      conversationId: conversation.id,
      callId: conversation.callId,
      at: now,
    });
    this.logger.info("conversation started", {
      tenantId: conversation.tenantId,
      conversationId: conversation.id,
    });

    return conversation;
  }
}
