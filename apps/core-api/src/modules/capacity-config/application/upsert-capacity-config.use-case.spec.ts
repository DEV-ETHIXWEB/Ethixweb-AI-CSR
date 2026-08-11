import type { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import { FakeAuditLogRepository } from "./__fakes__/fake-audit-log-repository";
import { FakeCapacityConfigRepository } from "./__fakes__/fake-capacity-config-repository";
import { FakeTenantContextService } from "./__fakes__/fake-tenant-context";
import { UpsertCapacityConfigUseCase } from "./upsert-capacity-config.use-case";

function buildUseCase(
  capacityConfigRepository = new FakeCapacityConfigRepository(),
  auditLogRepository = new FakeAuditLogRepository(),
) {
  return {
    useCase: new UpsertCapacityConfigUseCase(
      new FakeTenantContextService() as unknown as TenantContextService,
      capacityConfigRepository,
      auditLogRepository,
    ),
    capacityConfigRepository,
    auditLogRepository,
  };
}

describe("UpsertCapacityConfigUseCase", () => {
  it("creates a new row on the first call, applying schema defaults for untouched fields", async () => {
    const { useCase } = buildUseCase();

    const result = await useCase.execute({
      tenantId: "tenant-1",
      businessId: "business-1",
      actorUserId: "user-1",
      patch: { maxTenantConcurrentCalls: 20 },
    });

    expect(result.maxTenantConcurrentCalls).toBe(20);
    expect(result.maxWaitingCallers).toBe(5); // schema default, untouched
  });

  it("updates an existing row on the second call, merging the patch without clobbering untouched fields", async () => {
    const { useCase, capacityConfigRepository } = buildUseCase();
    await useCase.execute({
      tenantId: "tenant-1",
      businessId: "business-1",
      actorUserId: "user-1",
      patch: { maxTenantConcurrentCalls: 20, overflowNumber: "+15551234567" },
    });

    const result = await useCase.execute({
      tenantId: "tenant-1",
      businessId: "business-1",
      actorUserId: "user-1",
      patch: { maxWaitingCallers: 12 },
    });

    expect(result.maxWaitingCallers).toBe(12);
    // Untouched by the second patch — must survive the merge, not be
    // clobbered back to a default.
    expect(result.maxTenantConcurrentCalls).toBe(20);
    expect(result.overflowNumber).toBe("+15551234567");

    const stored = await capacityConfigRepository.findByBusiness(
      undefined as never,
      "tenant-1",
      "business-1",
    );
    expect(stored?.maxWaitingCallers).toBe(12);
    expect(stored?.maxTenantConcurrentCalls).toBe(20);
  });

  it("tenant isolation: tenant A cannot upsert into tenant B's businessId row", async () => {
    const { useCase, capacityConfigRepository } = buildUseCase();
    capacityConfigRepository.seed({
      id: "config-1",
      tenantId: "tenant-b",
      businessId: "business-shared",
      maxTenantConcurrentCalls: 10,
      maxWaitingCallers: 5,
      waitingTimeoutMs: 30000,
      emergencyHeadroomRatio: 0.2,
      overflowNumber: null,
      brochureEnabled: false,
      brochureRotationMs: 15000,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await expect(
      useCase.execute({
        tenantId: "tenant-a",
        businessId: "business-shared",
        actorUserId: "user-1",
        patch: { maxTenantConcurrentCalls: 999 },
      }),
    ).rejects.toThrow();
  });

  it("writes an AuditLog entry with action capacity_config.updated, before=null on first creation", async () => {
    const { useCase, auditLogRepository } = buildUseCase();

    await useCase.execute({
      tenantId: "tenant-1",
      businessId: "business-1",
      actorUserId: "user-1",
      patch: { maxTenantConcurrentCalls: 20 },
    });

    expect(auditLogRepository.entries).toHaveLength(1);
    expect(auditLogRepository.entries[0]).toMatchObject({
      tenantId: "tenant-1",
      actorId: "user-1",
      actorType: "user",
      action: "capacity_config.updated",
      resourceType: "tenant_capacity_config",
      before: null,
    });
  });

  it("writes an AuditLog entry with the prior row as `before` on a subsequent update", async () => {
    const { useCase, auditLogRepository } = buildUseCase();
    await useCase.execute({
      tenantId: "tenant-1",
      businessId: "business-1",
      actorUserId: "user-1",
      patch: { maxTenantConcurrentCalls: 20 },
    });

    await useCase.execute({
      tenantId: "tenant-1",
      businessId: "business-1",
      actorUserId: "user-1",
      patch: { maxTenantConcurrentCalls: 30 },
    });

    expect(auditLogRepository.entries).toHaveLength(2);
    const before = auditLogRepository.entries[1]?.before as {
      maxTenantConcurrentCalls: number;
    } | null;
    expect(before?.maxTenantConcurrentCalls).toBe(20);
  });
});
