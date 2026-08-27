import { NotFoundDomainError, ValidationDomainError } from "../../../shared/domain/domain-error";

export class KnowledgeItemNotFoundError extends NotFoundDomainError {
  constructor(public readonly itemId: string) {
    super(`Knowledge item not found: ${itemId}`);
    this.name = "KnowledgeItemNotFoundError";
  }
}

/**
 * 422, not 409 — this is a validation failure on the requested transition
 * itself (the caller asked for something the state machine never allows,
 * e.g. approved -> approved or approved -> draft directly), not a
 * lost-the-race concurrency conflict against a value the caller couldn't
 * have known ahead of time (that's ConcurrentLeadModificationError's job
 * in the leads module, 409). See domain/knowledge-lifecycle.ts for the
 * transition table this enforces.
 */
export class InvalidKnowledgeLifecycleTransitionError extends ValidationDomainError {
  constructor(
    public readonly itemId: string,
    public readonly from: string,
    public readonly to: string,
  ) {
    super(`Invalid knowledge item status transition for ${itemId}: "${from}" -> "${to}"`);
    this.name = "InvalidKnowledgeLifecycleTransitionError";
  }
}
