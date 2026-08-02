import type { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import { InvalidUsageQuantityError, UsageOccurredInFutureError } from "../domain/errors";
import { createNoopLogger } from "./__fakes__/fake-logger";
import { FakeTenantContextService } from "./__fakes__/fake-tenant-context";
import { FakeUsageRecordRepository } from "./__fakes__/fake-usage-record-repository";
import { RecordUsageUseCase, type RecordUsageCommand } from "./record-usage.use-case";

function buildUseCase(usageRecordRepository = new FakeUsageRecordRepository()) {
  return {
    useCase: new RecordUsageUseCase(
      new FakeTenantContextService() as unknown as TenantContextService,
      usageRecordRepository,
      createNoopLogger(),
    ),
    usageRecordRepository,
  };
}

function baseCommand(overrides: Partial<RecordUsageCommand> = {}): RecordUsageCommand {
  return {
    tenantId: "tenant-1",
    businessId: "business-1",
    callId: "call-1",
    usageType: "voice_call_duration",
    source: "twilio",
    quantity: 120,
    unit: "seconds",
    dedupKey: "call-1:voice_call_duration:final",
    occurredAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("RecordUsageUseCase", () => {
  it("records a usage event and returns the created record", async () => {
    const { useCase } = buildUseCase();

    const record = await useCase.execute(baseCommand());

    expect(record.usageType).toBe("voice_call_duration");
    expect(record.quantity).toBe(120);
    expect(record.tenantId).toBe("tenant-1");
  });

  it("rejects a negative quantity before touching the repository", async () => {
    const { useCase, usageRecordRepository } = buildUseCase();
    const createSpy = jest.spyOn(usageRecordRepository, "create");

    await expect(useCase.execute(baseCommand({ quantity: -1 }))).rejects.toThrow(
      InvalidUsageQuantityError,
    );
    expect(createSpy).not.toHaveBeenCalled();
  });

  it("rejects a non-integer quantity", async () => {
    const { useCase } = buildUseCase();

    await expect(useCase.execute(baseCommand({ quantity: 1.5 }))).rejects.toThrow(
      InvalidUsageQuantityError,
    );
  });

  it("BOUNDARY: zero quantity is valid — a real, billable-relevant usage event of zero units (e.g. a call that connected then instantly ended)", async () => {
    const { useCase } = buildUseCase();

    const record = await useCase.execute(baseCommand({ quantity: 0 }));

    expect(record.quantity).toBe(0);
  });

  it("BOUNDARY: a very large quantity is accepted without overflow/precision loss", async () => {
    const { useCase } = buildUseCase();
    const largeQuantity = 2_147_483_000; // near INT4 max, the Postgres column type

    const record = await useCase.execute(baseCommand({ quantity: largeQuantity }));

    expect(record.quantity).toBe(largeQuantity);
  });

  it("rejects an occurredAt more than the clock-skew tolerance in the future", async () => {
    const { useCase } = buildUseCase();
    const farFuture = new Date(Date.now() + 10 * 60_000).toISOString();

    await expect(useCase.execute(baseCommand({ occurredAt: farFuture }))).rejects.toThrow(
      UsageOccurredInFutureError,
    );
  });

  it("BOUNDARY: an occurredAt a few seconds in the future (ordinary clock skew) is accepted, not rejected", async () => {
    const { useCase } = buildUseCase();
    const slightlyFuture = new Date(Date.now() + 5_000).toISOString();

    const record = await useCase.execute(baseCommand({ occurredAt: slightlyFuture }));

    expect(record).toBeDefined();
  });

  describe("idempotent ingestion — repeated delivery must not double-record", () => {
    it("a replayed dedupKey returns the EXISTING record without creating a second row", async () => {
      const { useCase, usageRecordRepository } = buildUseCase();
      const command = baseCommand();

      const first = await useCase.execute(command);
      const second = await useCase.execute(command);

      expect(second.id).toBe(first.id);
      const all = await usageRecordRepository.listByCall(undefined as never, "tenant-1", "call-1");
      expect(all).toHaveLength(1);
    });

    it("the SAME dedupKey for a DIFFERENT tenant is an independent record, not a collision (dedup is tenant-scoped)", async () => {
      const { useCase } = buildUseCase();
      const key = "shared-dedup-key";

      const a = await useCase.execute(baseCommand({ tenantId: "tenant-1", dedupKey: key }));
      const b = await useCase.execute(baseCommand({ tenantId: "tenant-2", dedupKey: key }));

      expect(a.id).not.toBe(b.id);
      expect(a.tenantId).toBe("tenant-1");
      expect(b.tenantId).toBe("tenant-2");
    });

    it("a DIFFERENT dedupKey for the same call is an independent record — e.g. two distinct STT segments of one call", async () => {
      const { useCase, usageRecordRepository } = buildUseCase();

      await useCase.execute(baseCommand({ dedupKey: "segment-1" }));
      await useCase.execute(baseCommand({ dedupKey: "segment-2" }));

      const all = await usageRecordRepository.listByCall(undefined as never, "tenant-1", "call-1");
      expect(all).toHaveLength(2);
    });

    it(
      "CONCURRENCY: two simultaneous ingestion attempts with the SAME dedupKey never create two " +
        "records — the losing attempt returns the winning row",
      async () => {
        const { useCase, usageRecordRepository } = buildUseCase();
        const command = baseCommand();

        const [first, second] = await Promise.all([
          useCase.execute(command),
          useCase.execute(command),
        ]);

        expect(first.id).toBe(second.id);
        const all = await usageRecordRepository.listByCall(
          undefined as never,
          "tenant-1",
          "call-1",
        );
        expect(all).toHaveLength(1);
      },
    );

    it("CONCURRENCY: replayed outbox-style redelivery (3 identical attempts) still yields exactly one record", async () => {
      const { useCase, usageRecordRepository } = buildUseCase();
      const command = baseCommand();

      const results = await Promise.all([
        useCase.execute(command),
        useCase.execute(command),
        useCase.execute(command),
      ]);

      const uniqueIds = new Set(results.map((r) => r.id));
      expect(uniqueIds.size).toBe(1);
      const all = await usageRecordRepository.listByCall(undefined as never, "tenant-1", "call-1");
      expect(all).toHaveLength(1);
    });
  });

  describe("tenant isolation", () => {
    it("stores the record scoped to the tenant that recorded it, not leaked to another tenant's queries", async () => {
      const { useCase, usageRecordRepository } = buildUseCase();

      await useCase.execute(baseCommand({ tenantId: "tenant-1", callId: "shared-call-id" }));
      await useCase.execute(
        baseCommand({ tenantId: "tenant-2", callId: "shared-call-id", dedupKey: "other-key" }),
      );

      const tenant1Records = await usageRecordRepository.listByCall(
        undefined as never,
        "tenant-1",
        "shared-call-id",
      );
      const tenant2Records = await usageRecordRepository.listByCall(
        undefined as never,
        "tenant-2",
        "shared-call-id",
      );
      expect(tenant1Records).toHaveLength(1);
      expect(tenant2Records).toHaveLength(1);
      expect(tenant1Records[0]?.id).not.toBe(tenant2Records[0]?.id);
    });
  });

  it("records the provider cost estimate when supplied, and leaves it null when not", async () => {
    const { useCase } = buildUseCase();

    const withCost = await useCase.execute(
      baseCommand({ dedupKey: "with-cost", estimatedProviderCostUsd: "0.001234" }),
    );
    const withoutCost = await useCase.execute(baseCommand({ dedupKey: "without-cost" }));

    expect(withCost.estimatedProviderCostUsd).toBe("0.001234");
    expect(withoutCost.estimatedProviderCostUsd).toBeNull();
  });

  it("stores arbitrary correlation metadata verbatim, defaulting to an empty object when omitted", async () => {
    const { useCase } = buildUseCase();

    const withMeta = await useCase.execute(
      baseCommand({ dedupKey: "with-meta", metadata: { twilioCallSid: "CA123" } }),
    );
    const withoutMeta = await useCase.execute(baseCommand({ dedupKey: "without-meta" }));

    expect(withMeta.metadata).toEqual({ twilioCallSid: "CA123" });
    expect(withoutMeta.metadata).toEqual({});
  });
});
