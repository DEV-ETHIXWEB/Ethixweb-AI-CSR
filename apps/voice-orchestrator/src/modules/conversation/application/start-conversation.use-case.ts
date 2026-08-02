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
 */
@Injectable()
export class StartConversationUseCase {
  constructor(
    @Inject(CONVERSATION_REPOSITORY) private readonly repository: ConversationRepository,
    private readonly assembleSystemPrompt: AssembleSystemPromptUseCase,
    @Inject(EVENT_BUS) private readonly eventBus: EventBusPort,
    @Inject(CORE_API_CLIENT) private readonly coreApiClient: CoreApiClientPort,
    @Inject(APP_LOGGER) private readonly logger: StructuredLogger,
  ) {}

  async execute(command: StartConversationCommand): Promise<Conversation> {
    setSpanAttributes({
      "ethixweb.tenant_id": command.tenantId,
      "ethixweb.business_id": command.businessId,
    });

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
      startedAt: now,
      endedAt: null,
      endReason: null,
    });

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
