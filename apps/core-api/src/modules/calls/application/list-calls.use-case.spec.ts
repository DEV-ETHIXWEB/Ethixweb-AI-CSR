import type { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import type { Call } from "../domain/call.entity";
import { FakeCallRepository } from "./__fakes__/fake-call-repository";
import { FakeTenantContextService } from "./__fakes__/fake-tenant-context";
import { ListCallsUseCase } from "./list-calls.use-case";

let counter = 0;
function makeCall(overrides: Partial<Call> = {}): Call {
  counter += 1;
  return {
    id: `call-${counter}`,
    tenantId: "tenant-1",
    businessId: "business-1",
    customerId: null,
    direction: "inbound",
    fromNumber: "+15551234567",
    toNumber: "+15559876543",
    telephonyCallSid: `CA-${counter}`,
    status: "in_progress",
    endReason: null,
    durationSeconds: null,
    startedAt: "2026-01-15T12:00:00.000Z",
    endedAt: null,
    ...overrides,
  };
}

function buildUseCase(callRepository: FakeCallRepository) {
  return new ListCallsUseCase(
    new FakeTenantContextService() as unknown as TenantContextService,
    callRepository,
  );
}

describe("ListCallsUseCase", () => {
  it("only returns calls for the requested tenant + business", async () => {
    const callRepository = new FakeCallRepository();
    callRepository.seed(makeCall());
    callRepository.seed(makeCall({ tenantId: "tenant-2" }));
    callRepository.seed(makeCall({ businessId: "business-2" }));
    const useCase = buildUseCase(callRepository);

    const result = await useCase.execute({
      tenantId: "tenant-1",
      businessId: "business-1",
      page: 1,
      pageSize: 20,
    });

    expect(result.total).toBe(1);
  });

  it("filters by status", async () => {
    const callRepository = new FakeCallRepository();
    callRepository.seed(makeCall({ status: "in_progress" }));
    callRepository.seed(makeCall({ status: "completed" }));
    const useCase = buildUseCase(callRepository);

    const result = await useCase.execute({
      tenantId: "tenant-1",
      businessId: "business-1",
      page: 1,
      pageSize: 20,
      status: "in_progress",
    });

    expect(result.total).toBe(1);
    expect(result.items[0]?.status).toBe("in_progress");
  });

  it("filters by createdAfter/createdBefore (against startedAt)", async () => {
    const callRepository = new FakeCallRepository();
    const old = makeCall({ startedAt: "2020-01-01T00:00:00.000Z" });
    const recent = makeCall({ startedAt: "2026-01-01T00:00:00.000Z" });
    callRepository.seed(old);
    callRepository.seed(recent);
    const useCase = buildUseCase(callRepository);

    const result = await useCase.execute({
      tenantId: "tenant-1",
      businessId: "business-1",
      page: 1,
      pageSize: 20,
      createdAfter: new Date("2025-01-01"),
    });

    expect(result.total).toBe(1);
    expect(result.items[0]?.id).toBe(recent.id);
  });

  it("paginates and orders newest-first", async () => {
    const callRepository = new FakeCallRepository();
    const first = makeCall({ startedAt: "2026-01-01T00:00:00.000Z" });
    const second = makeCall({ startedAt: "2026-01-02T00:00:00.000Z" });
    const third = makeCall({ startedAt: "2026-01-03T00:00:00.000Z" });
    callRepository.seed(first);
    callRepository.seed(second);
    callRepository.seed(third);
    const useCase = buildUseCase(callRepository);

    const page1 = await useCase.execute({
      tenantId: "tenant-1",
      businessId: "business-1",
      page: 1,
      pageSize: 2,
    });
    const page2 = await useCase.execute({
      tenantId: "tenant-1",
      businessId: "business-1",
      page: 2,
      pageSize: 2,
    });

    expect(page1.total).toBe(3);
    expect(page1.items.map((call) => call.id)).toEqual([third.id, second.id]);
    expect(page2.items.map((call) => call.id)).toEqual([first.id]);
  });
});
