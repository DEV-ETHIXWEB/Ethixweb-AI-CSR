import { Inject, Injectable } from "@nestjs/common";
import type { StructuredLogger } from "@ethixweb/shared-kernel";
import { APP_LOGGER } from "../../../shared/observability/app-logger.module";
import { setSpanAttributes } from "../../../shared/observability/tracing";
import { EVENT_BUS, type EventBusPort } from "../../events/domain/orchestrator-event";
import {
  CORE_API_CLIENT,
  type CoreApiClientPort,
} from "../../tool-broker/domain/ports/core-api-client.port";
import {
  CALL_ADMISSION_PORT,
  type CallAdmissionPort,
} from "../../capacity/domain/call-admission.port";
import type { Conversation } from "../domain/conversation.entity";
import { ConversationNotFoundError } from "../domain/errors";
import {
  CONVERSATION_REPOSITORY,
  type ConversationRepository,
} from "../domain/ports/conversation-repository.port";

export interface EndConversationCommand {
  tenantId: string;
  conversationId: string;
  endReason: string;
}

/**
 * PRODUCTION-BLOCKER FIX: also closes the `Call` row's lifecycle in
 * core-api's calls module — `POST /internal/calls/by-telephony-sid/:sid/end`
 * (keyed on this conversation's own `callId`, which IS the Voice Runtime's
 * telephonyCallSid, see StartConversationUseCase's own comment). "Call ends
 * before a lead exists" and "call never produces a lead" are both handled
 * correctly by construction: ending a call never touches/blocks Lead
 * creation in either direction (EndCallUseCase's own comment), and a lead
 * created LATER in the same call still references the same, already-real
 * `Call.id` regardless of whether the call has since ended. Best-effort,
 * NOT blocking: unlike StartConversationUseCase's call creation (which
 * MUST succeed before a conversation can start, since Lead.callId's FK
 * depends on it), a failure here must never prevent the Voice Runtime's
 * hangup signal from completing — the conversation has already ended from
 * the runtime's perspective, and every other side effect in this method
 * (event publish, logging) is already best-effort/non-blocking for the
 * identical reason.
 *
 * PHASE 10: also emits `voice_call_duration` usage (docs/26's ingestion
 * contract, `POST /internal/usage`) — best-effort, same reasoning. This is
 * deliberately the ONLY usage dimension wired here: `llm_tokens`/
 * `stt_duration`/`tts_characters` all need data no part of this codebase
 * currently produces (`AiCompletionChunk` reports no token counts from any
 * of the three provider adapters; STT/TTS metrics can only come from a
 * real Voice Runtime, which doesn't exist in this repository) — see
 * docs/27's own honest accounting of this rather than fabricating partial
 * metering for dimensions with no real data behind them.
 *
 * DOCS/36: also releases this conversation's capacity reservation
 * (StartConversationUseCase's own admission-time reserve) — best-effort,
 * same reasoning as the other two side effects in this method. A Redis TTL
 * on the reservation itself is the safety net if this call never happens
 * (a crashed runtime, a lost end-signal) — see RedisCallAdmissionAdapter's
 * own comment.
 */
@Injectable()
export class EndConversationUseCase {
  constructor(
    @Inject(CONVERSATION_REPOSITORY) private readonly repository: ConversationRepository,
    @Inject(EVENT_BUS) private readonly eventBus: EventBusPort,
    @Inject(CORE_API_CLIENT) private readonly coreApiClient: CoreApiClientPort,
    @Inject(CALL_ADMISSION_PORT) private readonly callAdmission: CallAdmissionPort,
    @Inject(APP_LOGGER) private readonly logger: StructuredLogger,
  ) {}

  /** Idempotent: ending an already-ended conversation returns it unchanged rather than erroring — the Voice Runtime may legitimately send a hangup event twice (retry, or both a caller-hangup and a call-ended signal). */
  async execute(command: EndConversationCommand): Promise<Conversation> {
    setSpanAttributes({
      "ethixweb.tenant_id": command.tenantId,
      "ethixweb.conversation_id": command.conversationId,
    });

    const conversation = await this.repository.findById(command.tenantId, command.conversationId);
    if (!conversation) {
      throw new ConversationNotFoundError(command.conversationId);
    }
    if (conversation.endedAt) {
      return conversation;
    }

    const now = new Date().toISOString();
    conversation.state = "ended";
    conversation.endedAt = now;
    conversation.endReason = command.endReason;
    const saved = await this.repository.save(conversation);

    await this.endCallBestEffort(saved, now, command.endReason);
    await this.recordCallDurationUsageBestEffort(saved, now);
    await this.releaseCapacityBestEffort(saved);

    await this.eventBus.publish({
      type: "conversation.ended",
      tenantId: saved.tenantId,
      conversationId: saved.id,
      endReason: command.endReason,
      at: now,
    });
    this.logger.info("conversation ended", {
      tenantId: saved.tenantId,
      conversationId: saved.id,
      endReason: command.endReason,
    });

    return saved;
  }

  private async endCallBestEffort(
    conversation: Conversation,
    endedAt: string,
    endReason: string,
  ): Promise<void> {
    try {
      await this.coreApiClient.post(`/internal/calls/by-telephony-sid/${conversation.callId}/end`, {
        status: conversation.leadId ? "completed" : "abandoned",
        endReason,
        endedAt,
      });
    } catch (error) {
      this.logger.warn("failed to end the corresponding Call row in core-api — non-fatal", {
        tenantId: conversation.tenantId,
        conversationId: conversation.id,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async recordCallDurationUsageBestEffort(
    conversation: Conversation,
    endedAt: string,
  ): Promise<void> {
    const durationSeconds = Math.max(
      0,
      Math.round((Date.parse(endedAt) - Date.parse(conversation.startedAt)) / 1000),
    );
    try {
      await this.coreApiClient.post("/internal/usage", {
        businessId: conversation.businessId,
        callId: conversation.callId,
        ...(conversation.leadId ? { leadId: conversation.leadId } : {}),
        usageType: "voice_call_duration",
        source: "voice-orchestrator",
        quantity: durationSeconds,
        unit: "seconds",
        // docs/26 §8's own recommended convention — one dedupKey per real
        // usage event (this conversation's single, final duration), so a
        // Voice Runtime retry of the end-call signal (already idempotent
        // above) can never double-count.
        dedupKey: `${conversation.id}:voice_call_duration:final`,
        occurredAt: endedAt,
      });
    } catch (error) {
      this.logger.warn("failed to record call-duration usage — non-fatal", {
        tenantId: conversation.tenantId,
        conversationId: conversation.id,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async releaseCapacityBestEffort(conversation: Conversation): Promise<void> {
    if (!conversation.capacityReservationId) {
      // Defensive only — every conversation created after docs/36 landed
      // always has one (StartConversationUseCase sets it unconditionally).
      // A null here means a conversation that predates this field, not a
      // bug; nothing to release.
      return;
    }
    try {
      await this.callAdmission.release(conversation.tenantId, conversation.capacityReservationId);
    } catch (error) {
      this.logger.warn("failed to release capacity reservation — non-fatal, TTL will reclaim it", {
        tenantId: conversation.tenantId,
        conversationId: conversation.id,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
