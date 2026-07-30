import { ConflictDomainError, NotFoundDomainError } from "../../../shared/domain/domain-error";

export class TenantNotFoundError extends NotFoundDomainError {
  constructor(public readonly tenantId: string) {
    super(`Tenant not found: ${tenantId}`);
    this.name = "TenantNotFoundError";
  }
}

export class BusinessNotFoundError extends NotFoundDomainError {
  constructor(public readonly businessId: string) {
    super(`Business not found: ${businessId}`);
    this.name = "BusinessNotFoundError";
  }
}

/**
 * A status transition was legal against the status the caller read, but the
 * row had already moved to a different status by the time the write was
 * attempted — a genuine write-write race (two concurrent transitions off
 * the same starting state), not a violation of the transition graph itself
 * (see tenant-lifecycle.ts's IllegalTenantStatusTransitionError for that
 * case). Distinct error on purpose: "your request was invalid" and "your
 * request was valid but someone else moved the target first, retry with
 * fresh state" call for different client handling.
 */
export class ConcurrentTenantModificationError extends ConflictDomainError {
  constructor(public readonly tenantId: string) {
    super(
      `Tenant ${tenantId} was modified concurrently — the status changed before this update could apply. Re-fetch and retry.`,
    );
    this.name = "ConcurrentTenantModificationError";
  }
}
