import {
  ConflictDomainError,
  ForbiddenDomainError,
  NotFoundDomainError,
} from "../../../shared/domain/domain-error";

export class LeadNotFoundError extends NotFoundDomainError {
  constructor(public readonly leadId: string) {
    super(`Lead not found: ${leadId}`);
    this.name = "LeadNotFoundError";
  }
}

export class CustomerNotFoundForLeadError extends NotFoundDomainError {
  constructor(public readonly customerId: string) {
    super(`Customer not found: ${customerId}`);
    this.name = "CustomerNotFoundForLeadError";
  }
}

/**
 * `Lead.callId` carries a real database foreign key to `calls.id`
 * (production-blocker fix, see calls module) — this surfaces the FK
 * violation (Prisma P2003) as a clear, actionable domain error instead of
 * a raw 500 if a caller ever races createLead ahead of `POST
 * /internal/calls`, or supplies a callId that was never actually started.
 * The documented ordering guarantee (Voice Runtime -> Voice Orchestrator
 * calls `POST /internal/calls` before creating its own Conversation) makes
 * this the exceptional path, not the common one — but a client bug/race
 * must still fail clearly, not crash unrecognizably.
 */
export class CallNotFoundForLeadError extends NotFoundDomainError {
  constructor(public readonly callId: string) {
    super(
      `No call found for callId ${callId} — start the call (POST /internal/calls) before creating a lead against it.`,
    );
    this.name = "CallNotFoundForLeadError";
  }
}

/**
 * docs/04-ai-tool-architecture.md §3.4: "Only callable within the same
 * call_id that created the lead" — updateLead's own authorization rule,
 * distinct from RBAC (a dispatcher role check answers "can this caller
 * update leads at all"; this answers "is this specific caller update
 * scoped to the call that created this specific lead").
 */
export class LeadUpdateNotAuthorizedError extends ForbiddenDomainError {
  constructor(
    public readonly leadId: string,
    public readonly callId: string,
  ) {
    super(`Lead ${leadId} was not created by call ${callId} — update not authorized.`);
    this.name = "LeadUpdateNotAuthorizedError";
  }
}

/**
 * Internal control-flow signal, NOT a DomainError — mirrors
 * CustomerPhoneAlreadyExistsError in the customers module exactly, and for
 * the same reason: hitting the `UNIQUE(call_id)` constraint concurrently is
 * the DOCUMENTED idempotency mechanism for createLead (docs/04 §3.3: "key =
 * call_id, one lead per call, hard constraint, not just a soft key"), never
 * an error a caller should see. CreateLeadUseCase always catches this
 * internally; if it ever escapes uncaught, that's a real bug worth a loud,
 * generic 500, not a misleadingly-specific mapped status code.
 */
export class LeadCallIdAlreadyExistsError extends Error {
  constructor(public readonly callId: string) {
    super(`A lead already exists for call ${callId}.`);
    this.name = "LeadCallIdAlreadyExistsError";
  }
}

export class LeadAlreadyClaimedError extends ConflictDomainError {
  constructor(public readonly leadId: string) {
    super(`Lead ${leadId} has already been claimed.`);
    this.name = "LeadAlreadyClaimedError";
  }
}

/**
 * A status transition was legal against the status the caller read, but a
 * concurrent transition already moved the lead to a different status first
 * — the same write-write race TransitionTenantStatusUseCase's own
 * ConcurrentTenantModificationError closes in the tenants module.
 */
export class ConcurrentLeadModificationError extends ConflictDomainError {
  constructor(public readonly leadId: string) {
    super(
      `Lead ${leadId} was modified concurrently — the status changed before this update could apply. Re-fetch and retry.`,
    );
    this.name = "ConcurrentLeadModificationError";
  }
}
