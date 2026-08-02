import { Inject, Injectable } from "@nestjs/common";
import type { StructuredLogger } from "@ethixweb/shared-kernel";
import { APP_LOGGER } from "../../../shared/observability/app-logger.module";
import { setSpanAttributes } from "../../../shared/observability/tracing";
import { EVENT_BUS, type EventBusPort } from "../../events/domain/orchestrator-event";
import {
  CORE_API_CLIENT,
  type CoreApiClientPort,
} from "../../tool-broker/domain/ports/core-api-client.port";
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
 */
@Injectable()
export class EndConversationUseCase {
  constructor(
    @Inject(CONVERSATION_REPOSITORY) private readonly repository: ConversationRepository,
    @Inject(EVENT_BUS) private readonly eventBus: EventBusPort,
    @Inject(CORE_API_CLIENT) private readonly coreApiClient: CoreApiClientPort,
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
}
