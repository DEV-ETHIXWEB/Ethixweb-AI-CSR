/** Mirrors apps/core-api/src/modules/capacity-config/interfaces/dto/capacity-config-response.dto.ts exactly. */
export interface CapacityConfig {
  id: string | null;
  tenantId: string;
  businessId: string;
  maxTenantConcurrentCalls: number;
  maxWaitingCallers: number;
  waitingTimeoutMs: number;
  emergencyHeadroomRatio: number;
  overflowNumber: string | null;
  brochureEnabled: boolean;
  brochureRotationMs: number;
  createdAt: string | null;
  updatedAt: string | null;
}
