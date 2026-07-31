import type { LeadStatus } from "@ethixweb/database";
import { ConflictDomainError } from "../../../shared/domain/domain-error";

/**
 * The lead status state machine. docs/13-implementation-backlog.md `leads`
 * module §4 documents the backbone literally: "new → notified → claimed →
 * converted_to_job | expired | duplicate" — enforced here as an explicit,
 * tested transition function, not scattered `status = 'x'` assignments,
 * the same discipline already applied to the tenant lifecycle
 * (domain/tenant-lifecycle.ts in the tenants module) and the conversation
 * engine (docs/03 §2).
 *
 * The schema's `LeadStatus` enum has a 7th value, `abandoned`, that
 * docs/13's one-line description doesn't place explicitly. This graph's
 * treatment of `abandoned` (reachable from `new`, `notified`, or `claimed`
 * — a caller/customer withdrawing can happen at any of those points, not
 * just one) is an INFORMED INFERENCE, not a verbatim requirement — flagged
 * here rather than presented as settled fact, the same epistemic honesty
 * already applied to the Housecall Pro adapter's [Confirmed]/[Unverified]
 * tagging. Revisit if a future doc pass pins this down more precisely.
 */
const ALLOWED_TRANSITIONS: Record<LeadStatus, readonly LeadStatus[]> = {
  new: ["notified", "duplicate", "abandoned"],
  notified: ["claimed", "expired", "duplicate", "abandoned"],
  claimed: ["converted_to_job", "expired", "abandoned"],
  converted_to_job: [],
  expired: [],
  duplicate: [],
  abandoned: [],
};

export class IllegalLeadStatusTransitionError extends ConflictDomainError {
  constructor(
    public readonly from: LeadStatus,
    public readonly to: LeadStatus,
  ) {
    super(`Illegal lead status transition: "${from}" -> "${to}"`);
    this.name = "IllegalLeadStatusTransitionError";
  }
}

/** Same-status "transitions" are treated as an idempotent no-op, not an error — same convention as the tenant lifecycle. */
export function assertValidLeadStatusTransition(from: LeadStatus, to: LeadStatus): void {
  if (from === to) {
    return;
  }
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new IllegalLeadStatusTransitionError(from, to);
  }
}
