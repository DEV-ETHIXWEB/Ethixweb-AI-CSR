import type { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import type { TenantCapacityConfig } from "../domain/tenant-capacity-config.entity";
import { FakeCapacityConfigRepository } from "./__fakes__/fake-capacity-config-repository";
import { FakeTenantContextService } from "./__fakes__/fake-tenant-context";
import {
  GetCapacityConfigUseCase,
  PLATFORM_DEFAULT_CAPACITY_CONFIG,
} from "./get-capacity-config.use-case";

function buildUseCase(capacityConfigRepository = new FakeCapacityConfigRepository()) {
  return {
    useCase: new GetCapacityConfigUseCase(
      new FakeTenantContextService() as unknown as TenantContextService,
      capacityConfigRepository,
    ),
    capacityConfigRepository,
  };
}

describe("GetCapacityConfigUseCase", () => {
  it("returns platform defaults when no row exists for the business, never throwing", async () => {
    const { useCase } = buildUseCase();

    const result = await useCase.execute("tenant-1", "business-1");

    expect(result.id).toBeNull();
    expect(result.tenantId).toBe("tenant-1");
    expect(result.businessId).toBe("business-1");
    expect(result.maxTenantConcurrentCalls).toBe(
      PLATFORM_DEFAULT_CAPACITY_CONFIG.maxTenantConcurrentCalls,
    );
    expect(result.maxWaitingCallers).toBe(PLATFORM_DEFAULT_CAPACITY_CONFIG.maxWaitingCallers);
    expect(result.waitingTimeoutMs).toBe(PLATFORM_DEFAULT_CAPACITY_CONFIG.waitingTimeoutMs);
    expect(result.emergencyHeadroomRatio).toBe(
      PLATFORM_DEFAULT_CAPACITY_CONFIG.emergencyHeadroomRatio,
    );
    expect(result.overflowNumber).toBeNull();
    expect(result.brochureEnabled).toBe(false);
    expect(result.brochureRotationMs).toBe(PLATFORM_DEFAULT_CAPACITY_CONFIG.brochureRotationMs);
    expect(result.createdAt).toBeNull();
    expect(result.updatedAt).toBeNull();
  });

  it("returns the real row when one is configured", async () => {
    const { useCase, capacityConfigRepository } = buildUseCase();
    const now = new Date();
    const row: TenantCapacityConfig = {
      id: "config-1",
      tenantId: "tenant-1",
      businessId: "business-1",
      maxTenantConcurrentCalls: 25,
      maxWaitingCallers: 8,
      waitingTimeoutMs: 45000,
      emergencyHeadroomRatio: 0.3,
      overflowNumber: "+15551234567",
      brochureEnabled: true,
      brochureRotationMs: 20000,
      createdAt: now,
      updatedAt: now,
    };
    capacityConfigRepository.seed(row);

    const result = await useCase.execute("tenant-1", "business-1");

    expect(result.id).toBe("config-1");
    expect(result.maxTenantConcurrentCalls).toBe(25);
    expect(result.overflowNumber).toBe("+15551234567");
    expect(result.brochureEnabled).toBe(true);
  });

  it("tenant isolation: never returns another tenant's configured row", async () => {
    const { useCase, capacityConfigRepository } = buildUseCase();
    capacityConfigRepository.seed({
      id: "config-1",
      tenantId: "tenant-2",
      businessId: "business-1",
      maxTenantConcurrentCalls: 99,
      maxWaitingCallers: 5,
      waitingTimeoutMs: 30000,
      emergencyHeadroomRatio: 0.2,
      overflowNumber: null,
      brochureEnabled: false,
      brochureRotationMs: 15000,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await useCase.execute("tenant-1", "business-1");

    // Falls back to defaults, not tenant-2's row.
    expect(result.id).toBeNull();
    expect(result.maxTenantConcurrentCalls).toBe(
      PLATFORM_DEFAULT_CAPACITY_CONFIG.maxTenantConcurrentCalls,
    );
  });
});
