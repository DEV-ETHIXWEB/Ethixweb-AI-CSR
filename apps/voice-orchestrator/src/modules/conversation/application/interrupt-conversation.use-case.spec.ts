import { IllegalConversationTransitionError } from "../domain/conversation-state";
import type { Conversation } from "../domain/conversation.entity";
import { ConversationAlreadyEndedError, ConversationNotFoundError } from "../domain/errors";
import { FakeConversationRepository } from "./__fakes__/fake-conversation-repository";
import { InterruptConversationUseCase } from "./interrupt-conversation.use-case";

function baseConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: "conv-1",
    tenantId: "tenant-1",
    businessId: "business-1",
    callId: "call-1",
    state: "qualifying",
    systemPrompt: "sys",
    llmModel: "gpt-4o",
    messages: [],
    transcript: [],
    leadId: null,
    startedAt: new Date().toISOString(),
    endedAt: null,
    capacityReservationId: "reservation-1",
    endReason: null,
    version: 1,
    ...overrides,
  };
}

describe("InterruptConversationUseCase", () => {
  it("transitions to silence, same as the generic transition this replaces for this one endpoint", async () => {
    const repository = new FakeConversationRepository();
    repository.seed(baseConversation());
    const useCase = new InterruptConversationUseCase(repository);

    const result = await useCase.execute("tenant-1", "conv-1");

    expect(result.state).toBe("silence");
  });

  it("rejects an illegal transition (e.g. from a state that can't reach silence)", async () => {
    const repository = new FakeConversationRepository();
    repository.seed(baseConversation({ state: "closing" }));
    const useCase = new InterruptConversationUseCase(repository);

    await expect(useCase.execute("tenant-1", "conv-1")).rejects.toThrow(
      IllegalConversationTransitionError,
    );
  });

  it("throws ConversationNotFoundError for an unknown conversation", async () => {
    const useCase = new InterruptConversationUseCase(new FakeConversationRepository());

    await expect(useCase.execute("tenant-1", "missing")).rejects.toThrow(ConversationNotFoundError);
  });

  it("throws ConversationAlreadyEndedError once ended", async () => {
    const repository = new FakeConversationRepository();
    repository.seed(baseConversation({ state: "ended", endedAt: new Date().toISOString() }));
    const useCase = new InterruptConversationUseCase(repository);

    await expect(useCase.execute("tenant-1", "conv-1")).rejects.toThrow(
      ConversationAlreadyEndedError,
    );
  });

  /**
   * Regression coverage for the actual reason this use case exists,
   * separate from the generic state transition: Voice Runtime only ever
   * calls POST /interrupt when TTS was actively playing an already-
   * fully-generated response (CallSessionOrchestrator.handleBargeIn only
   * fires it when `ttsPlaying`, never while a turn's own completion was
   * still in flight — that path aborts the completion directly, which
   * already truncates responseText correctly). By the time this runs,
   * HandleTurnUseCase.runTurn has ALREADY durably saved the FULL intended
   * response into conversation.messages as if the caller heard every
   * word — before playback even started, let alone before the caller cut
   * it off partway through. Without this annotation, the model's own
   * memory of "what I just said" is silently wrong on the common
   * mid-playback barge-in case.
   */
  describe("annotating the interrupted assistant message", () => {
    it("appends the interruption note to the last assistant message", async () => {
      const repository = new FakeConversationRepository();
      repository.seed(
        baseConversation({
          messages: [
            { role: "user", content: "my AC stopped cooling" },
            {
              role: "assistant",
              content: "I'm sorry to hear that. Is it blowing warm air, or barely any air at all?",
            },
          ],
        }),
      );
      const useCase = new InterruptConversationUseCase(repository);

      const result = await useCase.execute("tenant-1", "conv-1");

      const lastMessage = result.messages.at(-1);
      expect(lastMessage?.role).toBe("assistant");
      expect(lastMessage?.content).toContain(
        "I'm sorry to hear that. Is it blowing warm air, or barely any air at all?",
      );
      expect(lastMessage?.content).toContain("the caller interrupted");
    });

    it("does NOT touch the durable transcript record — only the model-facing messages history", async () => {
      const repository = new FakeConversationRepository();
      repository.seed(
        baseConversation({
          messages: [{ role: "assistant", content: "Let me check that for you" }],
          transcript: [
            {
              turnIndex: 0,
              speaker: "agent",
              text: "Let me check that for you",
              confidence: null,
              offsetMs: 0,
              at: "2026-01-01T00:00:00.000Z",
            },
          ],
        }),
      );
      const useCase = new InterruptConversationUseCase(repository);

      const result = await useCase.execute("tenant-1", "conv-1");

      expect(result.transcript[0]?.text).toBe("Let me check that for you");
    });

    it("does nothing when the last message is from the caller, not the assistant (nothing to annotate)", async () => {
      const repository = new FakeConversationRepository();
      repository.seed(
        baseConversation({
          messages: [
            { role: "assistant", content: "What's your address?" },
            { role: "user", content: "123 Main Street" },
          ],
        }),
      );
      const useCase = new InterruptConversationUseCase(repository);

      const result = await useCase.execute("tenant-1", "conv-1");

      expect(result.messages.at(-1)).toEqual({ role: "user", content: "123 Main Street" });
    });

    it("is idempotent — a retried /interrupt call for the same message does not stack the note twice", async () => {
      const repository = new FakeConversationRepository();
      repository.seed(
        baseConversation({
          messages: [{ role: "assistant", content: "Let me check that for you" }],
        }),
      );
      const useCase = new InterruptConversationUseCase(repository);

      await useCase.execute("tenant-1", "conv-1");
      // Second call targets the SAME state ("silence" -> "silence"), a
      // legal no-op transition per assertValidConversationTransition's
      // own same-state rule — exactly what a network-retried /interrupt
      // looks like.
      const result = await useCase.execute("tenant-1", "conv-1");

      const occurrences = result.messages.at(-1)?.content.split("the caller interrupted").length;
      expect(occurrences).toBe(2); // one split -> one occurrence, not stacked
    });
  });

  describe("lost CAS race against a concurrent conversation write", () => {
    it("retries once and succeeds when a benign concurrent write (e.g. a turn's transcript append) landed first", async () => {
      const repository = new FakeConversationRepository();
      const seeded = baseConversation({
        messages: [{ role: "assistant", content: "Let me check that for you" }],
      });
      repository.seed(seeded);
      const useCase = new InterruptConversationUseCase(repository);
      const originalSave = repository.save.bind(repository);
      let firstAttempt = true;
      repository.save = async (conversation) => {
        if (firstAttempt) {
          firstAttempt = false;
          await originalSave({
            ...seeded,
            transcript: [
              {
                turnIndex: 0,
                speaker: "caller",
                text: "hi",
                confidence: null,
                offsetMs: 0,
                at: "2026-01-01T00:00:00.000Z",
              },
            ],
          });
        }
        return originalSave(conversation);
      };

      const result = await useCase.execute("tenant-1", "conv-1");

      expect(result.state).toBe("silence");
      expect(result.transcript).toHaveLength(1);
      expect(result.messages.at(-1)?.content).toContain("the caller interrupted");
    });

    it("throws ConversationAlreadyEndedError, not a silent no-op, when the conversation ended mid-race", async () => {
      const repository = new FakeConversationRepository();
      const seeded = baseConversation();
      repository.seed(seeded);
      const useCase = new InterruptConversationUseCase(repository);
      const originalSave = repository.save.bind(repository);
      repository.save = async (conversation) => {
        await originalSave({
          ...seeded,
          state: "ended",
          endedAt: "2026-01-01T00:00:00.000Z",
          endReason: "caller_hangup",
        });
        return originalSave(conversation);
      };

      await expect(useCase.execute("tenant-1", "conv-1")).rejects.toThrow(
        ConversationAlreadyEndedError,
      );
    });
  });
});
