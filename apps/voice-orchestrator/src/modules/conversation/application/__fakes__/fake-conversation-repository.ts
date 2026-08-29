import type { Conversation } from "../../domain/conversation.entity";
import { ConversationAlreadyExistsError } from "../../domain/errors";
import type { ConversationRepository } from "../../domain/ports/conversation-repository.port";

/** Deep-clones via a JSON round-trip — matches RedisConversationRepository, which always (de)serializes JSON and can never hand back a live reference to what's actually stored. Without this, two callers that both `findById()` the same conversation would silently share one mutable object, masking exactly the class of lost-update bug this fake exists to let tests reproduce. */
function clone(conversation: Conversation): Conversation {
  return JSON.parse(JSON.stringify(conversation)) as Conversation;
}

export class FakeConversationRepository implements ConversationRepository {
  private readonly byId = new Map<string, Conversation>();
  private readonly idByCall = new Map<string, string>();

  async create(conversation: Conversation): Promise<Conversation> {
    const callKey = `${conversation.tenantId}:${conversation.callId}`;
    if (this.idByCall.has(callKey)) {
      throw new ConversationAlreadyExistsError(conversation.callId);
    }
    this.idByCall.set(callKey, conversation.id);
    this.byId.set(conversation.id, clone(conversation));
    return clone(conversation);
  }

  async findById(tenantId: string, conversationId: string): Promise<Conversation | null> {
    const conversation = this.byId.get(conversationId);
    return conversation && conversation.tenantId === tenantId ? clone(conversation) : null;
  }

  async findByCallId(tenantId: string, callId: string): Promise<Conversation | null> {
    const id = this.idByCall.get(`${tenantId}:${callId}`);
    return id ? this.findById(tenantId, id) : null;
  }

  /** Mirrors RedisConversationRepository's own CAS discipline (see its own comment) so a unit test exercising a lost-race path behaves the same as production. */
  async save(conversation: Conversation): Promise<Conversation | null> {
    const stored = this.byId.get(conversation.id);
    if (!stored || stored.version !== conversation.version) {
      return null;
    }
    const next: Conversation = { ...clone(conversation), version: conversation.version + 1 };
    this.byId.set(conversation.id, next);
    return clone(next);
  }

  /** Test helper. */
  seed(conversation: Conversation): void {
    const stored = clone(conversation);
    this.byId.set(stored.id, stored);
    this.idByCall.set(`${stored.tenantId}:${stored.callId}`, stored.id);
  }
}
