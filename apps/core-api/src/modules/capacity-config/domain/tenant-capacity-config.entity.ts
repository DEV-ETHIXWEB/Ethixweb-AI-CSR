/**
 * docs/06-database-schema.md TENANT_CAPACITY_CONFIGS / docs/36's per-tenant
 * capacity policy. `Date`, not `string` — same convention decision as
 * knowledge/domain/knowledge-item.entity.ts (a CRUD entity edited through
 * dashboard use cases, not a telephony-webhook-driven entity like Call).
 */
export interface TenantCapacityConfig {
  id: string;
  tenantId: string;
  businessId: string;
  maxTenantConcurrentCalls: number;
  maxWaitingCallers: number;
  waitingTimeoutMs: number;
  emergencyHeadroomRatio: number;
  overflowNumber: string | null;
  brochureEnabled: boolean;
  brochureRotationMs: number;
  createdAt: Date;
  updatedAt: Date;
}
