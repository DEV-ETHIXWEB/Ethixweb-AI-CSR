/** The tenant lifecycle statuses this service can observe — mirrors core-api's own `TenantStatus` enum (docs/15-tenant-lifecycle-billing-and-analytics.md §2), duplicated rather than imported since this service shares no runtime code with core-api, only the wire contract. */
export type TenantStatus =
  "trial" | "active" | "past_due" | "suspended" | "expired" | "offboarding" | "archived";

/**
 * The pre-admission gate docs/15 §2 requires but nothing previously
 * enforced: "`Suspended` is not `Deleted`: inbound calls to a suspended
 * tenant's number get an honest, configurable message ... rather than
 * either silently answering with a degraded/broken AI or a hard hangup."
 * `tenants.status` was already a real, enforced state machine
 * (TransitionTenantStatusUseCase, core-api) — this port is what reads it
 * before a call is ever admitted, closing the gap between the documented
 * requirement and what the call path actually checked.
 */
export interface TenantStatusProvider {
  /**
   * Never throws on a lookup failure (core-api unreachable, timeout) —
   * returns `"active"` instead, matching HttpCapacityConfigProvider's own
   * fail-open discipline for this exact hot path: a core-api hiccup must
   * degrade capacity/brochure data, never take down live call answering.
   * A missed suspension during a brief outage is a rare, low-cost gap;
   * rejecting every call during any core-api blip would be a far worse
   * regression than the gap it would close.
   */
  getStatus(tenantId: string): Promise<TenantStatus>;
}

export const TENANT_STATUS_PROVIDER = Symbol("TENANT_STATUS_PROVIDER");

/**
 * Statuses under which a tenant's calls may still be answered by the AI.
 * Only `suspended` is explicitly named in docs/15 §2; `expired`,
 * `offboarding`, and `archived` are an INFERRED extension of that same
 * rule (flagged per this codebase's own convention for inferred defaults,
 * e.g. tool-catalog.ts's getServiceAreas comment) — each of those statuses
 * represents a tenant that has, one way or another, already left active
 * paid service, so the same "honest message, not a live AI" treatment
 * applies. `trial` and `past_due` are deliberately still serviceable:
 * `past_due` is the documented grace-period state BEFORE `suspended`
 * (docs/15 §2's own diagram: dunning must be "exhausted" first), not
 * itself a call-blocking status.
 */
export const SERVICEABLE_TENANT_STATUSES: ReadonlySet<TenantStatus> = new Set([
  "trial",
  "active",
  "past_due",
]);
