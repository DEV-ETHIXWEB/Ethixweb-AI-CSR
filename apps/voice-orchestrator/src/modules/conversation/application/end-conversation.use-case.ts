import { Inject, Injectable } from "@nestjs/common";
import type { StructuredLogger } from "@ethixweb/shared-kernel";
import { APP_LOGGER } from "../../../shared/observability/app-logger.module";
import { setSpanAttributes } from "../../../shared/observability/tracing";
import { EVENT_BUS, type EventBusPort } from "../../events/domain/orchestrator-event";
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

@Injectable()
export class EndConversationUseCase {
  constructor(
    @Inject(CONVERSATION_REPOSITORY) private readonly repository: ConversationRepository,
    @Inject(EVENT_BUS) private readonly eventBus: EventBusPort,
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
}
