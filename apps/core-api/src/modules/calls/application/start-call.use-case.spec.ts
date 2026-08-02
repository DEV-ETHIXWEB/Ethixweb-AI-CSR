import type { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import { createNoopLogger } from "./__fakes__/fake-logger";
import { FakeCallRepository } from "./__fakes__/fake-call-repository";
import { FakeTenantContextService } from "./__fakes__/fake-tenant-context";
import { StartCallUseCase, type StartCallCommand } from "./start-call.use-case";

function buildUseCase(callRepository = new FakeCallRepository()) {
  return {
    useCase: new StartCallUseCase(
      new FakeTenantContextService() as unknown as TenantContextService,
      callRepository,
      createNoopLogger(),
    ),
    callRepository,
  };
}

function baseCommand(overrides: Partial<StartCallCommand> = {}): StartCallCommand {
  return {
    tenantId: "tenant-1",
    businessId: "business-1",
    direction: "inbound",
    fromNumber: "+15551234567",
    toNumber: "+15559876543",
    telephonyCallSid: "CA-abc123",
    startedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("StartCallUseCase", () => {
  it("creates a call in in_progress status", async () => {
    const { useCase } = buildUseCase();

    const call = await useCase.execute(baseCommand());

    expect(call.status).toBe("in_progress");
    expect(call.tenantId).toBe("tenant-1");
    expect(call.telephonyCallSid).toBe("CA-abc123");
  });

  it("stores a null customerId when none is supplied yet (searchCustomer hasn't run)", async () => {
    const { useCase } = buildUseCase();

    const call = await useCase.execute(baseCommand());

    expect(call.customerId).toBeNull();
  });

  it("stores the customerId when supplied", async () => {
    const { useCase } = buildUseCase();

    const call = await useCase.execute(baseCommand({ customerId: "customer-1" }));

    expect(call.customerId).toBe("customer-1");
  });

  describe("idempotent call creation — duplicate call.started must never create duplicate rows", () => {
    it("a replayed telephonyCallSid returns the EXISTING call, not a new one", async () => {
      const { useCase, callRepository } = buildUseCase();
      const command = baseCommand();

      const first = await useCase.execute(command);
      const second = await useCase.execute(command);

      expect(second.id).toBe(first.id);
      const found = await callRepository.findByTelephonyCallSid(
        undefined as never,
        "tenant-1",
        "CA-abc123",
      );
      expect(found?.id).toBe(first.id);
    });

    it("the SAME telephonyCallSid for a DIFFERENT tenant is an independent call (tenant-scoped dedup)", async () => {
      const { useCase } = buildUseCase();
      const sid = "shared-sid";

      const a = await useCase.execute(baseCommand({ tenantId: "tenant-1", telephonyCallSid: sid }));
      const b = await useCase.execute(baseCommand({ tenantId: "tenant-2", telephonyCallSid: sid }));

      expect(a.id).not.toBe(b.id);
    });

    it(
      "CONCURRENCY: two simultaneous call.started deliveries with the SAME telephonyCallSid never " +
        "create two rows — the losing attempt returns the winning row",
      async () => {
        const { useCase, callRepository } = buildUseCase();
        const command = baseCommand();

        const [first, second] = await Promise.all([
          useCase.execute(command),
          useCase.execute(command),
        ]);

        expect(first.id).toBe(second.id);
        const found = await callRepository.findByTelephonyCallSid(
          undefined as never,
          "tenant-1",
          "CA-abc123",
        );
        expect(found?.id).toBe(first.id);
      },
    );

    it("CONCURRENCY: replayed telephony-webhook redelivery (3 identical attempts) still yields exactly one call", async () => {
      const { useCase } = buildUseCase();
      const command = baseCommand();

      const results = await Promise.all([
        useCase.execute(command),
        useCase.execute(command),
        useCase.execute(command),
      ]);

      const uniqueIds = new Set(results.map((r) => r.id));
      expect(uniqueIds.size).toBe(1);
    });
  });

  describe("tenant isolation", () => {
    it("stores the call scoped to the tenant that started it", async () => {
      const { useCase, callRepository } = buildUseCase();

      await useCase.execute(baseCommand({ tenantId: "tenant-1", telephonyCallSid: "sid-1" }));
      await useCase.execute(baseCommand({ tenantId: "tenant-2", telephonyCallSid: "sid-2" }));

      const tenant1Call = await callRepository.findByTelephonyCallSid(
        undefined as never,
        "tenant-1",
        "sid-1",
      );
      const tenant2LookupOfTenant1Sid = await callRepository.findByTelephonyCallSid(
        undefined as never,
        "tenant-2",
        "sid-1",
      );
      expect(tenant1Call).not.toBeNull();
      expect(tenant2LookupOfTenant1Sid).toBeNull();
    });
  });
});
