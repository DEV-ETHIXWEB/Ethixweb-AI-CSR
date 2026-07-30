import type { TenantStatus } from "@ethixweb/database";
import { ConflictDomainError } from "../../../shared/domain/domain-error";

/**
 * The tenant lifecycle state machine, docs/15-tenant-lifecycle-billing-and-analytics.md §2.
 * Enforced here at the domain layer (not just "documented and hoped for") so
 * an illegal transition (e.g. `archived -> active`) is rejected before any
 * database write is attempted, not discovered later as corrupted state.
 */
const ALLOWED_TRANSITIONS: Record<TenantStatus, readonly TenantStatus[]> = {
  trial: ["active", "expired"],
  active: ["past_due", "suspended"],
  past_due: ["active", "suspended"],
  suspended: ["active", "offboarding"],
  expired: ["offboarding"],
  offboarding: ["archived"],
  archived: [],
};

export class IllegalTenantStatusTransitionError extends ConflictDomainError {
  constructor(
    public readonly from: TenantStatus,
    public readonly to: TenantStatus,
  ) {
    super(`Illegal tenant status transition: "${from}" -> "${to}"`);
    this.name = "IllegalTenantStatusTransitionError";
  }
}

/** Same-status "transitions" are treated as an idempotent no-op, not an error. */
export function assertValidTenantStatusTransition(from: TenantStatus, to: TenantStatus): void {
  if (from === to) {
    return;
  }
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new IllegalTenantStatusTransitionError(from, to);
  }
}
