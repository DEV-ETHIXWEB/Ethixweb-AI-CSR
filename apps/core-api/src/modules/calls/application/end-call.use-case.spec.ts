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

  it("resolves a lost race as idempotent when a concurrent request already landed the SAME target status", async () => {
    // Simulates the true concurrency scenario a real Postgres CAS handles:
    // this request reads status="in_progress" and decides to transition to
    // "completed", but by the time its own compare-and-swap write runs, a
    // concurrent request has already committed that exact same transition.
    const { useCase, callRepository } = buildUseCase();
    const call = seedInProgressCall(callRepository);
    callRepository.updateStatus = async () => {
      // The "concurrent winner" commits first, then this request's own CAS
      // sees the row already moved and loses the race — exactly what a real
      // Postgres `updateMany({ where: { status: fromStatus } })` returning
      // `count: 0` looks like from the use case's point of view.
      callRepository.seed({ ...call, status: "completed", endReason: "concurrent_winner" });
      return null;
    };

    const result = await useCase.execute({
      tenantId: "tenant-1",
      telephonyCallSid: "CA-abc123",
      status: "completed",
      endReason: "caller_hangup",
      endedAt: "2026-01-15T12:03:00.000Z",
    });

    expect(result.status).toBe("completed");
    expect(result.endReason).toBe("concurrent_winner");
  });

  it("throws IllegalCallStatusTransitionError when a lost race resolves to a DIFFERENT terminal status", async () => {
    // Same race shape, but the concurrent winner landed "abandoned" while
    // this request wanted "completed" — a genuine conflict that must
    // surface as a 409, not silently overwrite or silently succeed.
    const { useCase, callRepository } = buildUseCase();
    seedInProgressCall(callRepository);
    const originalUpdateStatus = callRepository.updateStatus.bind(callRepository);
    callRepository.updateStatus = async (db, tenantId, id, _fromStatus, _toStatus, fields) => {
      await originalUpdateStatus(db, tenantId, id, "in_progress", "abandoned", fields);
      return null;
    };

    await expect(
      useCase.execute({
        tenantId: "tenant-1",
        telephonyCallSid: "CA-abc123",
        status: "completed",
        endReason: "caller_hangup",
        endedAt: "2026-01-15T12:03:00.000Z",
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

  /**
   * Regression coverage for a silent, ongoing data loss found by a QA
   * pass: the `transcripts` table had 0 rows after four real production
   * calls, because nothing in the codebase ever wrote to it. The
   * conversation existed only in Redis, under a TTL — so once it expired
   * there was no record of what was said on a call.
   */
  describe("transcript persistence", () => {
    const turns = [
      { turnIndex: 0, speaker: "caller", text: "my sink is leaking", confidence: 0.94 },
      { turnIndex: 1, speaker: "agent", text: "Got it — let me help with that." },
    ];

    it("persists the transcript turns handed to it when a call ends", async () => {
      const { useCase, callRepository } = buildUseCase();
      seedInProgressCall(callRepository);

      await useCase.execute({
        tenantId: "tenant-1",
        telephonyCallSid: "CA-abc123",
        status: "completed",
        endedAt: "2026-01-15T12:05:00.000Z",
        transcript: turns,
      });

      expect(callRepository.savedTranscripts.get("call-1")).toEqual(turns);
    });

    it("is idempotent across a repeated end-call delivery — no duplicate turns", async () => {
      const { useCase, callRepository } = buildUseCase();
      seedInProgressCall(callRepository);
      const command = {
        tenantId: "tenant-1",
        telephonyCallSid: "CA-abc123",
        status: "completed" as const,
        endedAt: "2026-01-15T12:05:00.000Z",
        transcript: turns,
      };

      await useCase.execute(command);
      await useCase.execute(command); // the runtime may signal call-ended twice

      expect(callRepository.savedTranscripts.get("call-1")).toHaveLength(2);
    });

    it("still ends the call when the transcript write throws — a lost transcript must never hold a call open", async () => {
      const { useCase, callRepository } = buildUseCase();
      seedInProgressCall(callRepository);
      callRepository.saveTranscript = async () => {
        throw new Error("transcripts table unavailable");
      };

      const result = await useCase.execute({
        tenantId: "tenant-1",
        telephonyCallSid: "CA-abc123",
        status: "completed",
        endedAt: "2026-01-15T12:05:00.000Z",
        transcript: turns,
      });

      expect(result.status).toBe("completed");
    });

    it("ends the call normally when no transcript is supplied at all", async () => {
      const { useCase, callRepository } = buildUseCase();
      seedInProgressCall(callRepository);

      const result = await useCase.execute({
        tenantId: "tenant-1",
        telephonyCallSid: "CA-abc123",
        status: "completed",
        endedAt: "2026-01-15T12:05:00.000Z",
      });

      expect(result.status).toBe("completed");
      expect(callRepository.savedTranscripts.size).toBe(0);
    });
  });
});
