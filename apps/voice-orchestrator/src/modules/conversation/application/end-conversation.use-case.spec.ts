import { FakeCoreApiClient } from "../../tool-broker/application/__fakes__/fake-core-api-client";
import type { Conversation } from "../domain/conversation.entity";
import { ConversationNotFoundError, ConversationSaveConflictError } from "../domain/errors";
import { FakeCallAdmissionPort } from "./__fakes__/fake-call-admission";
import { FakeConversationRepository } from "./__fakes__/fake-conversation-repository";
import { FakeEventBus } from "./__fakes__/fake-event-bus";
import { createNoopLogger } from "./__fakes__/fake-logger";
import { EndConversationUseCase } from "./end-conversation.use-case";

function baseConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: "conv-1",
    tenantId: "tenant-1",
    businessId: "business-1",
    callId: "call-1",
    state: "closing",
    systemPrompt: "sys",
    llmModel: "gpt-4o",
    messages: [],
    transcript: [],
    leadId: null,
    capacityReservationId: "reservation-1",
    startedAt: new Date().toISOString(),
    endedAt: null,
    endReason: null,
    version: 1,
    ...overrides,
  };
}

function buildUseCase(coreApiClient = new FakeCoreApiClient()) {
  const repository = new FakeConversationRepository();
  const eventBus = new FakeEventBus();
  const callAdmission = new FakeCallAdmissionPort();
  const useCase = new EndConversationUseCase(
    repository,
    eventBus,
    coreApiClient,
    callAdmission,
    createNoopLogger(),
  );
  return { useCase, repository, eventBus, coreApiClient, callAdmission };
}

describe("EndConversationUseCase", () => {
  it("marks the conversation ended, sets endReason, and publishes conversation.ended", async () => {
    const { useCase, repository, eventBus } = buildUseCase();
    repository.seed(baseConversation());

    const result = await useCase.execute({
      tenantId: "tenant-1",
      conversationId: "conv-1",
      endReason: "caller_hangup",
    });

    expect(result.state).toBe("ended");
    expect(result.endReason).toBe("caller_hangup");
    expect(eventBus.eventsOfType("conversation.ended")).toHaveLength(1);
  });

  it("is idempotent — ending an already-ended conversation returns it unchanged, no duplicate event", async () => {
    const { useCase, repository, eventBus } = buildUseCase();
    repository.seed(
      baseConversation({ endedAt: "2026-01-01T00:00:00.000Z", endReason: "first_reason" }),
    );

    const result = await useCase.execute({
      tenantId: "tenant-1",
      conversationId: "conv-1",
      endReason: "second_reason",
    });

    expect(result.endReason).toBe("first_reason");
    expect(eventBus.eventsOfType("conversation.ended")).toHaveLength(0);
  });

  it("throws ConversationNotFoundError for an unknown conversation", async () => {
    const { useCase } = buildUseCase();

    await expect(
      useCase.execute({ tenantId: "tenant-1", conversationId: "missing", endReason: "x" }),
    ).rejects.toThrow(ConversationNotFoundError);
  });

  describe("lost CAS race against a concurrent conversation write", () => {
    // Regression tests for a real bug: EndConversationUseCase's
    // findById-mutate-save was not by itself atomic. A live turn's slow
    // tool call (HandleTurnUseCase) can still be mid-flight when the caller
    // hangs up — both read the same version, and without a CAS the loser's
    // write would silently vanish (or worse, resurrect an ended
    // conversation). These simulate the "concurrent winner" the same way
    // end-call.use-case.spec.ts does: monkey-patch the fake repository's
    // save() to inject a competing write at the exact moment this use
    // case's own save() runs.

    it("resolves as idempotent when the concurrent winner ALSO ended the conversation", async () => {
      const { useCase, repository, eventBus } = buildUseCase();
      const seeded = baseConversation();
      repository.seed(seeded);
      const originalSave = repository.save.bind(repository);
      repository.save = async (conversation) => {
        // The "concurrent winner" (e.g. a duplicate hangup signal handled
        // by a second concurrent request) lands first.
        await originalSave({
          ...seeded,
          state: "ended",
          endedAt: "2026-01-01T00:00:00.000Z",
          endReason: "concurrent_winner",
        });
        return originalSave(conversation);
      };

      const result = await useCase.execute({
        tenantId: "tenant-1",
        conversationId: "conv-1",
        endReason: "this_request_reason",
      });

      expect(result.state).toBe("ended");
      expect(result.endReason).toBe("concurrent_winner");
      // Only the winner's end should have published — this request lost
      // the race and must not double-publish/double-fire best-effort
      // side effects for an end that already happened.
      expect(eventBus.eventsOfType("conversation.ended")).toHaveLength(0);
    });

    it("reapplies the end mutation on top of a non-terminal concurrent write (e.g. a slow turn's save landing first)", async () => {
      const { useCase, repository, eventBus } = buildUseCase();
      const seeded = baseConversation();
      repository.seed(seeded);
      const originalSave = repository.save.bind(repository);
      let firstAttempt = true;
      repository.save = async (conversation) => {
        if (firstAttempt) {
          firstAttempt = false;
          // A concurrent turn's own (unrelated) save lands first, bumping
          // the version without ending the conversation.
          await originalSave({ ...seeded, transcript: [{ turnIndex: 0, speaker: "caller", text: "hi", confidence: null, offsetMs: 0, at: "2026-01-01T00:00:00.000Z" }] });
          return originalSave(conversation);
        }
        return originalSave(conversation);
      };

      const result = await useCase.execute({
        tenantId: "tenant-1",
        conversationId: "conv-1",
        endReason: "caller_hangup",
      });

      expect(result.state).toBe("ended");
      expect(result.endReason).toBe("caller_hangup");
      // The concurrent turn's own write survives — reapplying the end
      // mutation on top of the fresh version must not clobber it.
      expect(result.transcript).toHaveLength(1);
      expect(eventBus.eventsOfType("conversation.ended")).toHaveLength(1);
    });

    it("throws ConversationSaveConflictError when the retry itself loses a second race", async () => {
      const { useCase, repository } = buildUseCase();
      repository.seed(baseConversation());
      repository.save = async () => null;

      await expect(
        useCase.execute({
          tenantId: "tenant-1",
          conversationId: "conv-1",
          endReason: "caller_hangup",
        }),
      ).rejects.toThrow(ConversationSaveConflictError);
    });
  });

  describe("production-blocker fix: ending the corresponding Call row (best-effort)", () => {
    it("calls POST /internal/calls/by-telephony-sid/:callId/end with status=abandoned when no lead was created", async () => {
      const { useCase, repository, coreApiClient } = buildUseCase();
      repository.seed(baseConversation({ leadId: null }));

      await useCase.execute({
        tenantId: "tenant-1",
        conversationId: "conv-1",
        endReason: "runtime_disconnected",
      });

      // 2 calls: the Call-end (this test's own concern) and Phase 10's own
      // best-effort usage-metering emission — see that describe block below
      // for its own dedicated tests.
      expect(coreApiClient.postCalls).toHaveLength(2);
      expect(coreApiClient.postCalls[0]?.path).toBe("/internal/calls/by-telephony-sid/call-1/end");
      expect(coreApiClient.postCalls[0]?.body).toMatchObject({ status: "abandoned" });
    });

    it("calls with status=completed when a lead WAS created on this call", async () => {
      const { useCase, repository, coreApiClient } = buildUseCase();
      repository.seed(baseConversation({ leadId: "lead-1" }));

      await useCase.execute({
        tenantId: "tenant-1",
        conversationId: "conv-1",
        endReason: "caller_hangup",
      });

      expect(coreApiClient.postCalls[0]?.body).toMatchObject({ status: "completed" });
    });

    it("BEST-EFFORT: a failure to end the Call row does NOT prevent the conversation from ending", async () => {
      const coreApiClient = new FakeCoreApiClient();
      coreApiClient.failWith = new Error("core-api unreachable");
      const { useCase, repository } = buildUseCase(coreApiClient);
      repository.seed(baseConversation());

      const result = await useCase.execute({
        tenantId: "tenant-1",
        conversationId: "conv-1",
        endReason: "caller_hangup",
      });

      expect(result.state).toBe("ended");
    });

    it("an already-ended conversation (idempotent replay) does NOT call core-api a second time", async () => {
      const { useCase, repository, coreApiClient } = buildUseCase();
      repository.seed(
        baseConversation({ endedAt: "2026-01-01T00:00:00.000Z", endReason: "first_reason" }),
      );

      await useCase.execute({
        tenantId: "tenant-1",
        conversationId: "conv-1",
        endReason: "second_reason",
      });

      expect(coreApiClient.postCalls).toHaveLength(0);
    });
  });

  describe("Phase 10: call-duration usage metering (best-effort)", () => {
    it("emits voice_call_duration to POST /internal/usage with the correct quantity", async () => {
      const { useCase, repository, coreApiClient } = buildUseCase();
      repository.seed(
        baseConversation({ startedAt: "2026-01-15T12:00:00.000Z", leadId: "lead-1" }),
      );

      await useCase.execute({
        tenantId: "tenant-1",
        conversationId: "conv-1",
        endReason: "caller_hangup",
      });

      const usageCall = coreApiClient.postCalls.find((c) => c.path === "/internal/usage");
      expect(usageCall).toBeDefined();
      expect(usageCall?.body).toMatchObject({
        businessId: "business-1",
        callId: "call-1",
        leadId: "lead-1",
        usageType: "voice_call_duration",
        source: "voice-orchestrator",
        unit: "seconds",
        dedupKey: "conv-1:voice_call_duration:final",
      });
    });

    it("omits leadId from the usage event when no lead was created", async () => {
      const { useCase, repository, coreApiClient } = buildUseCase();
      repository.seed(baseConversation({ leadId: null }));

      await useCase.execute({
        tenantId: "tenant-1",
        conversationId: "conv-1",
        endReason: "caller_hangup",
      });

      const usageCall = coreApiClient.postCalls.find((c) => c.path === "/internal/usage");
      expect(usageCall?.body).not.toHaveProperty("leadId");
    });

    it("BEST-EFFORT: a failure recording usage does NOT prevent the conversation from ending", async () => {
      const coreApiClient = new FakeCoreApiClient();
      coreApiClient.failWith = new Error("core-api unreachable");
      const { useCase, repository } = buildUseCase(coreApiClient);
      repository.seed(baseConversation());

      const result = await useCase.execute({
        tenantId: "tenant-1",
        conversationId: "conv-1",
        endReason: "caller_hangup",
      });

      expect(result.state).toBe("ended");
    });

    it("an already-ended conversation (idempotent replay) does NOT emit a second usage event", async () => {
      const { useCase, repository, coreApiClient } = buildUseCase();
      repository.seed(
        baseConversation({ endedAt: "2026-01-01T00:00:00.000Z", endReason: "first_reason" }),
      );

      await useCase.execute({
        tenantId: "tenant-1",
        conversationId: "conv-1",
        endReason: "second_reason",
      });

      expect(coreApiClient.postCalls.filter((c) => c.path === "/internal/usage")).toHaveLength(0);
    });
  });

  describe("docs/36: capacity reservation release (best-effort)", () => {
    it("releases the conversation's capacity reservation on end", async () => {
      const { useCase, repository, callAdmission } = buildUseCase();
      const { reservationId } = await callAdmission.reserve("tenant-1", "business-1", {
        maxTenantConcurrentCalls: 10,
        maxGlobalConcurrentCalls: 100,
        emergencyHeadroomRatio: 0,
        isEmergencyPriority: false,
      });
      repository.seed(baseConversation({ capacityReservationId: reservationId }));

      await useCase.execute({
        tenantId: "tenant-1",
        conversationId: "conv-1",
        endReason: "caller_hangup",
      });

      const counts = await callAdmission.getActiveCounts("tenant-1");
      expect(counts.tenantActive).toBe(0);
    });

    it("best-effort: a release failure does not prevent the conversation from ending", async () => {
      const { useCase, repository, callAdmission } = buildUseCase();
      jest.spyOn(callAdmission, "release").mockRejectedValueOnce(new Error("redis unreachable"));
      repository.seed(baseConversation());

      const result = await useCase.execute({
        tenantId: "tenant-1",
        conversationId: "conv-1",
        endReason: "caller_hangup",
      });

      expect(result.state).toBe("ended");
    });

    it("does nothing (no error) when capacityReservationId is null — a conversation from before this field existed", async () => {
      const { useCase, repository, callAdmission } = buildUseCase();
      const releaseSpy = jest.spyOn(callAdmission, "release");
      repository.seed(baseConversation({ capacityReservationId: null }));

      await useCase.execute({
        tenantId: "tenant-1",
        conversationId: "conv-1",
        endReason: "caller_hangup",
      });

      expect(releaseSpy).not.toHaveBeenCalled();
    });
  });
});
