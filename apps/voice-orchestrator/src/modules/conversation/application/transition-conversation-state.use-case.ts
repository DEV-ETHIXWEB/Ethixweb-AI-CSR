import { Inject, Injectable } from "@nestjs/common";
import { setSpanAttributes } from "../../../shared/observability/tracing";
import type { Conversation } from "../domain/conversation.entity";
import {
  assertValidConversationTransition,
  type ConversationState,
} from "../domain/conversation-state";
import {
  ConversationAlreadyEndedError,
  ConversationNotFoundError,
  ConversationSaveConflictError,
} from "../domain/errors";
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
    const saved = await this.repository.save(conversation);
    if (saved) {
      return saved;
    }
    return this.resolveLostRace(tenantId, conversationId, toState);
  }

  /**
   * A concurrent writer (e.g. a still-in-flight turn's own `save()`, which
   * never touches `state`) landed first. Re-reads and, unless the
   * conversation ended in the meantime, reapplies this SAME transition on
   * top of the fresher version — a single retry, not a loop, matching this
   * module's other two CAS callers (EndConversationUseCase,
   * HandleTurnUseCase's own comments explain why one re-read is enough).
   */
  private async resolveLostRace(
    tenantId: string,
    conversationId: string,
    toState: ConversationState,
  ): Promise<Conversation> {
    const fresh = await this.repository.findById(tenantId, conversationId);
    if (!fresh) {
      throw new ConversationNotFoundError(conversationId);
    }
    if (fresh.endedAt) {
      throw new ConversationAlreadyEndedError(conversationId);
    }
    assertValidConversationTransition(fresh.state, toState);
    fresh.state = toState;
    const saved = await this.repository.save(fresh);
    if (!saved) {
      throw new ConversationSaveConflictError(conversationId);
    }
    return saved;
  }
}
