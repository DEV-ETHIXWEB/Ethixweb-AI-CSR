import type { Conversation } from "../../domain/conversation.entity";
import { ConversationAlreadyExistsError } from "../../domain/errors";
import type { ConversationRepository } from "../../domain/ports/conversation-repository.port";

export class FakeConversationRepository implements ConversationRepository {
  private readonly byId = new Map<string, Conversation>();
  private readonly idByCall = new Map<string, string>();

  async create(conversation: Conversation): Promise<Conversation> {
    const callKey = `${conversation.tenantId}:${conversation.callId}`;
    if (this.idByCall.has(callKey)) {
      throw new ConversationAlreadyExistsError(conversation.callId);
    }
    this.idByCall.set(callKey, conversation.id);
    this.byId.set(conversation.id, conversation);
    return conversation;
  }

  async findById(tenantId: string, conversationId: string): Promise<Conversation | null> {
    const conversation = this.byId.get(conversationId);
    return conversation && conversation.tenantId === tenantId ? conversation : null;
  }

  async findByCallId(tenantId: string, callId: string): Promise<Conversation | null> {
    const id = this.idByCall.get(`${tenantId}:${callId}`);
    return id ? this.findById(tenantId, id) : null;
  }

  async save(conversation: Conversation): Promise<Conversation> {
    this.byId.set(conversation.id, conversation);
    return conversation;
  }

  /** Test helper. */
  seed(conversation: Conversation): void {
    this.byId.set(conversation.id, conversation);
    this.idByCall.set(`${conversation.tenantId}:${conversation.callId}`, conversation.id);
  }
}
