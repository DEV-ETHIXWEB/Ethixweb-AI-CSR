import type { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import type { Call } from "../domain/call.entity";
import { CallNotFoundError } from "../domain/errors";
import { FakeCallRepository } from "./__fakes__/fake-call-repository";
import { FakeTenantContextService } from "./__fakes__/fake-tenant-context";
import { GetCallUseCase } from "./get-call.use-case";

function buildUseCase(callRepository = new FakeCallRepository()) {
  return {
    useCase: new GetCallUseCase(
      new FakeTenantContextService() as unknown as TenantContextService,
      callRepository,
    ),
    callRepository,
  };
}

function seedCall(repository: FakeCallRepository, overrides: Partial<Call> = {}): Call {
  const call: Call = {
    id: "call-1",
    tenantId: "tenant-1",
    businessId: "business-1",
    customerId: null,
    direction: "inbound",
    fromNumber: "+15551234567",
    toNumber: "+15559876543",
    telephonyCallSid: "CA-abc123",
    status: "in_progress",
    endReason: null,
    durationSeconds: null,
    startedAt: "2026-01-15T12:00:00.000Z",
    endedAt: null,
    ...overrides,
  };
  repository.seed(call);
  return call;
}

describe("GetCallUseCase", () => {
  it("returns the call for the tenant that owns it", async () => {
    const { useCase, callRepository } = buildUseCase();
    seedCall(callRepository);

    const call = await useCase.execute("tenant-1", "call-1");

    expect(call.id).toBe("call-1");
  });

  it("throws CallNotFoundError for an unknown callId", async () => {
    const { useCase } = buildUseCase();

    await expect(useCase.execute("tenant-1", "unknown")).rejects.toThrow(CallNotFoundError);
  });

  it("tenant isolation: never returns another tenant's call", async () => {
    const { useCase, callRepository } = buildUseCase();
    seedCall(callRepository, { tenantId: "tenant-1" });

    await expect(useCase.execute("tenant-2", "call-1")).rejects.toThrow(CallNotFoundError);
  });
});
