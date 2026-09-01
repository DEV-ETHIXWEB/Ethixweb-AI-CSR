import { Inject, Injectable } from "@nestjs/common";
import { setSpanAttributes } from "../../../shared/observability/tracing";
import type { Conversation } from "../domain/conversation.entity";
import { ConversationNotFoundError } from "../domain/errors";
import {
  CONVERSATION_REPOSITORY,
  type ConversationRepository,
} from "../domain/ports/conversation-repository.port";

/**
 * Closes the gap flagged in docs/24 §5: `ConversationRepository.findByCallId`
 * existed at the repository layer but was never exposed over HTTP, so a
 * Voice Runtime process that crashes and restarts mid-call had no way to
 * rediscover the orchestrator-generated `conversationId` it would otherwise
 * only have learned from the original `POST /` response. Same
 * not-found/cross-tenant behavior as GetConversationUseCase — a wrong or
 * hostile tenantId yields 404, never another tenant's data.
 */
@Injectable()
export class GetConversationByCallIdUseCase {
  constructor(
    @Inject(CONVERSATION_REPOSITORY) private readonly repository: ConversationRepository,
  ) {}

  async execute(tenantId: string, callId: string): Promise<Conversation> {
    setSpanAttributes({
      "ethixweb.tenant_id": tenantId,
      "ethixweb.call_id": callId,
    });

    const conversation = await this.repository.findByCallId(tenantId, callId);
    if (!conversation) {
      throw new ConversationNotFoundError(callId);
    }
    return conversation;
  }
}
