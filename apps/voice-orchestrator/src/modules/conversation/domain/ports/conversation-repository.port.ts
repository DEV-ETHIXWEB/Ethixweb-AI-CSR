import type { Conversation } from "../conversation.entity";

export interface ConversationRepository {
  /** Throws ConversationAlreadyExistsError if a conversation already exists for this callId — one conversation per call, mirroring `leads.call_id`'s own hard uniqueness constraint. */
  create(conversation: Conversation): Promise<Conversation>;
  findById(tenantId: string, conversationId: string): Promise<Conversation | null>;
  findByCallId(tenantId: string, callId: string): Promise<Conversation | null>;
  /**
   * Optimistic-concurrency save, keyed on `conversation.version` (the value
   * `findById`/`findByCallId` returned it with) — returns the newly-saved
   * conversation (with `version` incremented) on success, or `null` if a
   * concurrent writer already saved a newer version first, WITHOUT writing
   * anything. Mirrors `CallRepository.updateStatus`'s identical CAS
   * discipline (core-api) — same underlying problem (two legitimate
   * concurrent writers touching the same aggregate), same fix shape. The
   * caller decides how to react to `null`: re-read and retry, or treat it
   * as "someone else already resolved this" (each of this repository's
   * three real callers documents its own specific policy).
   */
  save(conversation: Conversation): Promise<Conversation | null>;
}

export const CONVERSATION_REPOSITORY = Symbol("CONVERSATION_REPOSITORY");
