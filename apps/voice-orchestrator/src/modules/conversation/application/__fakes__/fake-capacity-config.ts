import type {
  CapacityConfig,
  CapacityConfigProvider,
} from "../../../capacity/domain/capacity-config";

const DEFAULT_CONFIG: Omit<CapacityConfig, "tenantId" | "businessId"> = {
  maxGlobalConcurrentCalls: 100,
  maxTenantConcurrentCalls: 10,
  maxWaitingCallers: 5,
  waitingTimeoutMs: 30_000,
  overflowNumber: null,
  emergencyHeadroomRatio: 0.2,
  brochure: {
    enabled: false,
    businessName: "the office",
    segments: [],
    rotationIntervalMs: 15_000,
  },
};

export class FakeCapacityConfigProvider implements CapacityConfigProvider {
  config: Omit<CapacityConfig, "tenantId" | "businessId"> = { ...DEFAULT_CONFIG };

  async getActiveConfig(tenantId: string, businessId: string): Promise<CapacityConfig> {
    return { tenantId, businessId, ...this.config };
  }
}
