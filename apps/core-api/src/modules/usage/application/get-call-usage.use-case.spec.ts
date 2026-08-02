import type { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import { FakeTenantContextService } from "./__fakes__/fake-tenant-context";
import { FakeUsageRecordRepository } from "./__fakes__/fake-usage-record-repository";
import { GetCallUsageUseCase } from "./get-call-usage.use-case";
import type { UsageRecord } from "../domain/usage-record.entity";

function buildUseCase(usageRecordRepository = new FakeUsageRecordRepository()) {
  return {
    useCase: new GetCallUsageUseCase(
      new FakeTenantContextService() as unknown as TenantContextService,
      usageRecordRepository,
    ),
    usageRecordRepository,
  };
}

function seedRecord(
  repository: FakeUsageRecordRepository,
  overrides: Partial<UsageRecord> = {},
): void {
  repository.seed({
    id: overrides.id ?? `rec-${Math.random()}`,
    tenantId: overrides.tenantId ?? "tenant-1",
    businessId: overrides.businessId ?? "business-1",
    callId: overrides.callId ?? "call-1",
    leadId: overrides.leadId ?? null,
    usageType: overrides.usageType ?? "voice_call_duration",
    source: overrides.source ?? "twilio",
    quantity: overrides.quantity ?? 60,
    unit: overrides.unit ?? "seconds",
    estimatedProviderCostUsd: overrides.estimatedProviderCostUsd ?? null,
    dedupKey: overrides.dedupKey ?? `dedup-${Math.random()}`,
    metadata: overrides.metadata ?? {},
    occurredAt: overrides.occurredAt ?? "2026-01-15T12:00:00.000Z",
    createdAt: overrides.createdAt ?? "2026-01-15T12:00:00.000Z",
  });
}

describe("GetCallUsageUseCase", () => {
  it("returns every usage record for the call, in chronological order — the full evidence trail", async () => {
    const { useCase, usageRecordRepository } = buildUseCase();
    seedRecord(usageRecordRepository, {
      id: "rec-2",
      usageType: "tts_characters",
      occurredAt: "2026-01-15T12:01:00.000Z",
    });
    seedRecord(usageRecordRepository, {
      id: "rec-1",
      usageType: "voice_call_duration",
      occurredAt: "2026-01-15T12:00:00.000Z",
    });

    const records = await useCase.execute("tenant-1", "call-1");

    expect(records.map((r) => r.id)).toEqual(["rec-1", "rec-2"]);
  });

  it("returns an empty array for a call with no recorded usage, not an error", async () => {
    const { useCase } = buildUseCase();

    const records = await useCase.execute("tenant-1", "unknown-call");

    expect(records).toEqual([]);
  });

  it("tenant isolation: never returns another tenant's usage for the same callId", async () => {
    const { useCase, usageRecordRepository } = buildUseCase();
    seedRecord(usageRecordRepository, {
      id: "rec-tenant-1",
      tenantId: "tenant-1",
      callId: "shared-call-id",
    });
    seedRecord(usageRecordRepository, {
      id: "rec-tenant-2",
      tenantId: "tenant-2",
      callId: "shared-call-id",
    });

    const records = await useCase.execute("tenant-1", "shared-call-id");

    expect(records).toHaveLength(1);
    expect(records[0]?.id).toBe("rec-tenant-1");
  });
});
