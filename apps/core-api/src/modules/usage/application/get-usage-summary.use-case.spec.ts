import type { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import { InvalidUsagePeriodError } from "../domain/errors";
import { FakeTenantContextService } from "./__fakes__/fake-tenant-context";
import { FakeUsageRecordRepository } from "./__fakes__/fake-usage-record-repository";
import { GetUsageSummaryUseCase } from "./get-usage-summary.use-case";
import type { UsageRecord } from "../domain/usage-record.entity";

function buildUseCase(usageRecordRepository = new FakeUsageRecordRepository()) {
  return {
    useCase: new GetUsageSummaryUseCase(
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

describe("GetUsageSummaryUseCase", () => {
  it("aggregates total quantity and record count per usage type within the period", async () => {
    const { useCase, usageRecordRepository } = buildUseCase();
    seedRecord(usageRecordRepository, { usageType: "voice_call_duration", quantity: 60 });
    seedRecord(usageRecordRepository, { usageType: "voice_call_duration", quantity: 90 });
    seedRecord(usageRecordRepository, { usageType: "llm_tokens", quantity: 500, unit: "tokens" });

    const summary = await useCase.execute({
      tenantId: "tenant-1",
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-02-01T00:00:00.000Z",
    });

    const voice = summary.totals.find((t) => t.usageType === "voice_call_duration");
    const llm = summary.totals.find((t) => t.usageType === "llm_tokens");
    expect(voice).toEqual({
      usageType: "voice_call_duration",
      unit: "seconds",
      totalQuantity: 150,
      recordCount: 2,
      totalEstimatedProviderCostUsd: null,
    });
    expect(llm?.totalQuantity).toBe(500);
  });

  it("sums estimatedProviderCostUsd across records of the same type", async () => {
    const { useCase, usageRecordRepository } = buildUseCase();
    seedRecord(usageRecordRepository, { estimatedProviderCostUsd: "0.001000" });
    seedRecord(usageRecordRepository, { estimatedProviderCostUsd: "0.002500" });

    const summary = await useCase.execute({
      tenantId: "tenant-1",
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-02-01T00:00:00.000Z",
    });

    expect(summary.totals[0]?.totalEstimatedProviderCostUsd).toBe("0.003500");
  });

  it("is reproducible: calling it twice against unchanged data returns identical totals", async () => {
    const { useCase, usageRecordRepository } = buildUseCase();
    seedRecord(usageRecordRepository, { quantity: 42 });
    const query = {
      tenantId: "tenant-1",
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-02-01T00:00:00.000Z",
    };

    const first = await useCase.execute(query);
    const second = await useCase.execute(query);

    expect(first.totals).toEqual(second.totals);
  });

  it("filters by businessId when provided", async () => {
    const { useCase, usageRecordRepository } = buildUseCase();
    seedRecord(usageRecordRepository, { businessId: "business-1", quantity: 10 });
    seedRecord(usageRecordRepository, { businessId: "business-2", quantity: 999 });

    const summary = await useCase.execute({
      tenantId: "tenant-1",
      businessId: "business-1",
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-02-01T00:00:00.000Z",
    });

    expect(summary.totals).toHaveLength(1);
    expect(summary.totals[0]?.totalQuantity).toBe(10);
  });

  it("filters by usageType when provided", async () => {
    const { useCase, usageRecordRepository } = buildUseCase();
    seedRecord(usageRecordRepository, { usageType: "voice_call_duration" });
    seedRecord(usageRecordRepository, { usageType: "sms_message", unit: "messages" });

    const summary = await useCase.execute({
      tenantId: "tenant-1",
      usageType: "sms_message",
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-02-01T00:00:00.000Z",
    });

    expect(summary.totals).toHaveLength(1);
    expect(summary.totals[0]?.usageType).toBe("sms_message");
  });

  describe("period boundaries — half-open interval [from, to)", () => {
    it("BOUNDARY: a record exactly AT `from` is included (inclusive lower bound)", async () => {
      const { useCase, usageRecordRepository } = buildUseCase();
      seedRecord(usageRecordRepository, { occurredAt: "2026-01-01T00:00:00.000Z", quantity: 1 });

      const summary = await useCase.execute({
        tenantId: "tenant-1",
        from: "2026-01-01T00:00:00.000Z",
        to: "2026-02-01T00:00:00.000Z",
      });

      expect(summary.totals[0]?.totalQuantity).toBe(1);
    });

    it("BOUNDARY: a record exactly AT `to` is EXCLUDED (exclusive upper bound) — the adjacent period owns it", async () => {
      const { useCase, usageRecordRepository } = buildUseCase();
      seedRecord(usageRecordRepository, { occurredAt: "2026-02-01T00:00:00.000Z", quantity: 1 });

      const summary = await useCase.execute({
        tenantId: "tenant-1",
        from: "2026-01-01T00:00:00.000Z",
        to: "2026-02-01T00:00:00.000Z",
      });

      expect(summary.totals).toHaveLength(0);
    });

    it("two adjacent periods tiled back-to-back never double-count a boundary record", async () => {
      const { useCase, usageRecordRepository } = buildUseCase();
      seedRecord(usageRecordRepository, { occurredAt: "2026-02-01T00:00:00.000Z", quantity: 1 });

      const january = await useCase.execute({
        tenantId: "tenant-1",
        from: "2026-01-01T00:00:00.000Z",
        to: "2026-02-01T00:00:00.000Z",
      });
      const february = await useCase.execute({
        tenantId: "tenant-1",
        from: "2026-02-01T00:00:00.000Z",
        to: "2026-03-01T00:00:00.000Z",
      });

      expect(january.totals).toHaveLength(0);
      expect(february.totals[0]?.totalQuantity).toBe(1);
    });

    it("rejects a period where `from` is not strictly before `to`", async () => {
      const { useCase } = buildUseCase();

      await expect(
        useCase.execute({
          tenantId: "tenant-1",
          from: "2026-02-01T00:00:00.000Z",
          to: "2026-01-01T00:00:00.000Z",
        }),
      ).rejects.toThrow(InvalidUsagePeriodError);
    });

    it("rejects an equal from/to (zero-width window)", async () => {
      const { useCase } = buildUseCase();

      await expect(
        useCase.execute({
          tenantId: "tenant-1",
          from: "2026-01-01T00:00:00.000Z",
          to: "2026-01-01T00:00:00.000Z",
        }),
      ).rejects.toThrow(InvalidUsagePeriodError);
    });
  });

  it("BOUNDARY: an empty period (no matching usage) returns an empty totals array, not an error", async () => {
    const { useCase } = buildUseCase();

    const summary = await useCase.execute({
      tenantId: "tenant-1",
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-02-01T00:00:00.000Z",
    });

    expect(summary.totals).toEqual([]);
  });

  it("tenant isolation: never includes another tenant's usage in the summary", async () => {
    const { useCase, usageRecordRepository } = buildUseCase();
    seedRecord(usageRecordRepository, { tenantId: "tenant-1", quantity: 10 });
    seedRecord(usageRecordRepository, { tenantId: "tenant-2", quantity: 999 });

    const summary = await useCase.execute({
      tenantId: "tenant-1",
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-02-01T00:00:00.000Z",
    });

    expect(summary.totals[0]?.totalQuantity).toBe(10);
  });
});
