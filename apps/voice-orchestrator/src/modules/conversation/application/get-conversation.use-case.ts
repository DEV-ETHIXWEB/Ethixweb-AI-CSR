import { Inject, Injectable } from "@nestjs/common";
import { setSpanAttributes } from "../../../shared/observability/tracing";
import type { Conversation } from "../domain/conversation.entity";
import { ConversationNotFoundError } from "../domain/errors";
import {
  CONVERSATION_REPOSITORY,
  type ConversationRepository,
} from "../domain/ports/conversation-repository.port";

@Injectable()
export class GetConversationUseCase {
  constructor(
    @Inject(CONVERSATION_REPOSITORY) private readonly repository: ConversationRepository,
  ) {}

  async execute(tenantId: string, conversationId: string): Promise<Conversation> {
    setSpanAttributes({
      "ethixweb.tenant_id": tenantId,
      "ethixweb.conversation_id": conversationId,
    });

    const conversation = await this.repository.findById(tenantId, conversationId);
    if (!conversation) {
      throw new ConversationNotFoundError(conversationId);
    }
    return conversation;
  }
}
