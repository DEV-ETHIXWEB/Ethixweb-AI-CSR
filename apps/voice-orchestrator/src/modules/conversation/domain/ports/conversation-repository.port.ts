import type { Conversation } from "../conversation.entity";

export interface ConversationRepository {
  /** Throws ConversationAlreadyExistsError if a conversation already exists for this callId — one conversation per call, mirroring `leads.call_id`'s own hard uniqueness constraint. */
  create(conversation: Conversation): Promise<Conversation>;
  findById(tenantId: string, conversationId: string): Promise<Conversation | null>;
  findByCallId(tenantId: string, callId: string): Promise<Conversation | null>;
  save(conversation: Conversation): Promise<Conversation>;
}

export const CONVERSATION_REPOSITORY = Symbol("CONVERSATION_REPOSITORY");
