import { Inject, Injectable } from "@nestjs/common";
import { setSpanAttributes } from "../../../shared/observability/tracing";
import type { Conversation } from "../domain/conversation.entity";
import {
  assertValidConversationTransition,
  type ConversationState,
} from "../domain/conversation-state";
import { ConversationAlreadyEndedError, ConversationNotFoundError } from "../domain/errors";
import {
  CONVERSATION_REPOSITORY,
  type ConversationRepository,
} from "../domain/ports/conversation-repository.port";

/** docs/03 §2: state transitions are deterministic code driven by the orchestrator, never free-form model judgment. */
@Injectable()
export class TransitionConversationStateUseCase {
  constructor(
    @Inject(CONVERSATION_REPOSITORY) private readonly repository: ConversationRepository,
  ) {}

  async execute(
    tenantId: string,
    conversationId: string,
    toState: ConversationState,
  ): Promise<Conversation> {
    setSpanAttributes({
      "ethixweb.tenant_id": tenantId,
      "ethixweb.conversation_id": conversationId,
    });

    const conversation = await this.repository.findById(tenantId, conversationId);
    if (!conversation) {
      throw new ConversationNotFoundError(conversationId);
    }
    if (conversation.endedAt) {
      throw new ConversationAlreadyEndedError(conversationId);
    }

    assertValidConversationTransition(conversation.state, toState);
    conversation.state = toState;
    return this.repository.save(conversation);
  }
}
