import type { CapacityConfigResult } from "../../../capacity-config/application/get-capacity-config.use-case";

export class FakeGetCapacityConfigUseCase {
  calls: Array<{ tenantId: string; businessId: string }> = [];
  result: CapacityConfigResult = {
    id: null,
    tenantId: "tenant-1",
    businessId: "business-1",
    maxTenantConcurrentCalls: 10,
    maxWaitingCallers: 5,
    waitingTimeoutMs: 30000,
    emergencyHeadroomRatio: 0.2,
    overflowNumber: null,
    brochureEnabled: false,
    brochureRotationMs: 15000,
    createdAt: null,
    updatedAt: null,
  };

  async execute(tenantId: string, businessId: string): Promise<CapacityConfigResult> {
    this.calls.push({ tenantId, businessId });
    return this.result;
  }
}
