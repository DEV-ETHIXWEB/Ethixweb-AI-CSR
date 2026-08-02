import type { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import type { Call } from "../domain/call.entity";
import { IllegalCallStatusTransitionError } from "../domain/call-lifecycle";
import { CallNotFoundError } from "../domain/errors";
import { createNoopLogger } from "./__fakes__/fake-logger";
import { FakeCallRepository } from "./__fakes__/fake-call-repository";
import { FakeTenantContextService } from "./__fakes__/fake-tenant-context";
import { EndCallUseCase } from "./end-call.use-case";

function buildUseCase(callRepository = new FakeCallRepository()) {
  return {
    useCase: new EndCallUseCase(
      new FakeTenantContextService() as unknown as TenantContextService,
      callRepository,
      createNoopLogger(),
    ),
    callRepository,
  };
}

function seedInProgressCall(repository: FakeCallRepository, overrides: Partial<Call> = {}): Call {
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

describe("EndCallUseCase", () => {
  it("transitions an in_progress call to completed, computing durationSeconds from startedAt/endedAt", async () => {
    const { useCase, callRepository } = buildUseCase();
    seedInProgressCall(callRepository);

    const ended = await useCase.execute({
      tenantId: "tenant-1",
      telephonyCallSid: "CA-abc123",
      status: "completed",
      endReason: "caller_hangup",
      endedAt: "2026-01-15T12:03:00.000Z",
    });

    expect(ended.status).toBe("completed");
    expect(ended.endReason).toBe("caller_hangup");
    expect(ended.durationSeconds).toBe(180);
  });

  it("transitions to abandoned when the runtime disconnects without a lead", async () => {
    const { useCase, callRepository } = buildUseCase();
    seedInProgressCall(callRepository);

    const ended = await useCase.execute({
      tenantId: "tenant-1",
      telephonyCallSid: "CA-abc123",
      status: "abandoned",
      endReason: "runtime_disconnected",
      endedAt: "2026-01-15T12:01:00.000Z",
    });

    expect(ended.status).toBe("abandoned");
  });

  it("throws CallNotFoundError for an unknown telephonyCallSid", async () => {
    const { useCase } = buildUseCase();

    await expect(
      useCase.execute({
        tenantId: "tenant-1",
        telephonyCallSid: "unknown-sid",
        status: "completed",
        endedAt: new Date().toISOString(),
      }),
    ).rejects.toThrow(CallNotFoundError);
  });

  it("is idempotent: ending an already-completed call with the SAME status returns it unchanged, not an error", async () => {
    const { useCase, callRepository } = buildUseCase();
    seedInProgressCall(callRepository, {
      status: "completed",
      endReason: "caller_hangup",
      endedAt: "2026-01-15T12:03:00.000Z",
      durationSeconds: 180,
    });

    const result = await useCase.execute({
      tenantId: "tenant-1",
      telephonyCallSid: "CA-abc123",
      status: "completed",
      endReason: "caller_hangup_retry",
      endedAt: "2026-01-15T12:03:00.000Z",
    });

    // Same-status call is a no-op — the ORIGINAL endReason is preserved, not overwritten.
    expect(result.endReason).toBe("caller_hangup");
  });

  it("rejects an illegal transition from one terminal status to a DIFFERENT terminal status", async () => {
    const { useCase, callRepository } = buildUseCase();
    seedInProgressCall(callRepository, { status: "completed" });

    await expect(
      useCase.execute({
        tenantId: "tenant-1",
        telephonyCallSid: "CA-abc123",
        status: "abandoned",
        endedAt: new Date().toISOString(),
      }),
    ).rejects.toThrow(IllegalCallStatusTransitionError);
  });

  it("tenant isolation: cannot end another tenant's call", async () => {
    const { useCase, callRepository } = buildUseCase();
    seedInProgressCall(callRepository, { tenantId: "tenant-1" });

    await expect(
      useCase.execute({
        tenantId: "tenant-2",
        telephonyCallSid: "CA-abc123",
        status: "completed",
        endedAt: new Date().toISOString(),
      }),
    ).rejects.toThrow(CallNotFoundError);
  });
});
