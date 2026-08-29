import { ConflictDomainError, NotFoundDomainError } from "../../../shared/domain/domain-error";

export class ConversationNotFoundError extends NotFoundDomainError {
  constructor(public readonly conversationId: string) {
    super(`Conversation not found: ${conversationId}`);
    this.name = "ConversationNotFoundError";
  }
}

export class ConversationAlreadyEndedError extends ConflictDomainError {
  constructor(public readonly conversationId: string) {
    super(`Conversation ${conversationId} has already ended — no further turns accepted.`);
    this.name = "ConversationAlreadyEndedError";
  }
}

export class ConversationAlreadyExistsError extends ConflictDomainError {
  constructor(public readonly callId: string) {
    super(`A conversation already exists for call ${callId}.`);
    this.name = "ConversationAlreadyExistsError";
  }
}

/** Mirrors ToolCallInFlightError's exact role, one layer up: a Voice Runtime retry for a turn still being processed, not a genuinely new turn. */
export class TurnAlreadyInFlightError extends ConflictDomainError {
  constructor(public readonly idempotencyKey: string) {
    super(`An identical turn is already in flight: ${idempotencyKey}`);
    this.name = "TurnAlreadyInFlightError";
  }
}

/**
 * A conversation's optimistic-concurrency `save()` (RedisConversationRepository)
 * lost its CAS race twice in a row — i.e. a THIRD concurrent writer touched
 * the same conversation between this request's re-read and its retry.
 * EndConversationUseCase's single re-read (mirroring EndCallUseCase's own
 * documented reasoning for why one re-read is normally sufficient) is not
 * provably sufficient here the way it is for a terminal call-status CAS,
 * since a conversation has no "no further outgoing transitions" invariant
 * to lean on — this error exists so a genuine three-way race surfaces as a
 * real, visible failure instead of silently looping or silently dropping
 * a side effect.
 */
export class ConversationSaveConflictError extends ConflictDomainError {
  constructor(public readonly conversationId: string) {
    super(`Conversation ${conversationId} lost a concurrent-write race twice in a row.`);
    this.name = "ConversationSaveConflictError";
  }
}
