export interface TenantRoute {
  tenantId: string;
  businessId: string;
  timezone?: string | undefined;
}

/**
 * Resolves the dialed number (`toNumber`) to which tenant/business owns
 * it — docs/28 §B.1: "Your runtime needs to resolve these from the dialed
 * number before calling this endpoint... it's telephony-provisioning
 * configuration, not something core-api or voice-orchestrator computes for
 * you." A real deployment likely wants this DB-backed (core-api owns
 * tenant/business data); this port is the seam for that swap, same pattern
 * as AgentProfileProvider in voice-orchestrator.
 */
export interface TenantRoutingProvider {
  resolve(toNumber: string): Promise<TenantRoute | null>;
}

export const TENANT_ROUTING_PROVIDER = Symbol("TENANT_ROUTING_PROVIDER");
