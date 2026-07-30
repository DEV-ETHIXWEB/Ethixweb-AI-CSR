import type { CRMAdapter } from "./crm-adapter.port";

/**
 * Resolves a stored `crmType` string (Integration.crmType) to the adapter
 * that handles it — the seam that makes adding a CRM additive (docs/05 §1:
 * "new adapter class + contract tests passing... never a reason to touch"
 * anything else), never a `switch` statement scattered across use-cases.
 *
 * Every adapter returned here is already circuit-breaker + retry wrapped
 * (docs/05 §1, docs/13 crm-integration §6) — callers never wrap it again.
 * `tenantId` is required, not just `crmType`, specifically so the circuit
 * breaker is keyed per (crmType, tenant): one tenant's Housecall Pro
 * account having a bad day (revoked key, HCP-side outage) must not trip the
 * breaker for every OTHER tenant also using Housecall Pro.
 */
export interface CrmAdapterRegistry {
  /** Throws UnknownCrmTypeError (../errors.ts) for a crmType with no registered adapter, including stubs. */
  resolve(crmType: string, tenantId: string): CRMAdapter;
}

export const CRM_ADAPTER_REGISTRY = Symbol("CRM_ADAPTER_REGISTRY");
