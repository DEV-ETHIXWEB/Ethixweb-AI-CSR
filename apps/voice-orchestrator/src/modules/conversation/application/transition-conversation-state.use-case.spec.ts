import { IllegalConversationTransitionError } from "../domain/conversation-state";
import type { Conversation } from "../domain/conversation.entity";
import { ConversationAlreadyEndedError, ConversationNotFoundError } from "../domain/errors";
import { FakeConversationRepository } from "./__fakes__/fake-conversation-repository";
import { TransitionConversationStateUseCase } from "./transition-conversation-state.use-case";

function baseConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: "conv-1",
    tenantId: "tenant-1",
    businessId: "business-1",
    callId: "call-1",
    state: "greeting",
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

describe("TransitionConversationStateUseCase", () => {
  it("transitions to a legal next state", async () => {
    const repository = new FakeConversationRepository();
    repository.seed(baseConversation());
    const useCase = new TransitionConversationStateUseCase(repository);

    const result = await useCase.execute("tenant-1", "conv-1", "identifying");

    expect(result.state).toBe("identifying");
  });

  it("rejects an illegal transition", async () => {
    const repository = new FakeConversationRepository();
    repository.seed(baseConversation({ state: "greeting" }));
    const useCase = new TransitionConversationStateUseCase(repository);

    await expect(useCase.execute("tenant-1", "conv-1", "closing")).rejects.toThrow(
      IllegalConversationTransitionError,
    );
  });

  it("throws ConversationNotFoundError for an unknown conversation", async () => {
    const useCase = new TransitionConversationStateUseCase(new FakeConversationRepository());

    await expect(useCase.execute("tenant-1", "missing", "identifying")).rejects.toThrow(
      ConversationNotFoundError,
    );
  });

  it("throws ConversationAlreadyEndedError once ended", async () => {
    const repository = new FakeConversationRepository();
    repository.seed(baseConversation({ state: "ended", endedAt: new Date().toISOString() }));
    const useCase = new TransitionConversationStateUseCase(repository);

    await expect(useCase.execute("tenant-1", "conv-1", "greeting")).rejects.toThrow(
      ConversationAlreadyEndedError,
    );
  });

  describe("lost CAS race against a concurrent conversation write", () => {
    // Regression tests for the same class of bug fixed in EndConversationUseCase
    // and HandleTurnUseCase: POST /:id/interrupt (this use case) and
    // POST /:id/turns (HandleTurnUseCase) can race for the same conversation
    // — findById/save here is not itself atomic against a concurrent writer.

    it("retries once and succeeds when a benign concurrent write (e.g. a turn's transcript append) landed first", async () => {
      const repository = new FakeConversationRepository();
      const seeded = baseConversation();
      repository.seed(seeded);
      const useCase = new TransitionConversationStateUseCase(repository);
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

      const result = await useCase.execute("tenant-1", "conv-1", "identifying");

      expect(result.state).toBe("identifying");
      // The concurrent turn's own write survives — this use case doesn't
      // own `transcript`, so retrying must not clobber it.
      expect(result.transcript).toHaveLength(1);
    });

    it("throws ConversationAlreadyEndedError, not a silent no-op, when the conversation ended mid-race", async () => {
      const repository = new FakeConversationRepository();
      const seeded = baseConversation();
      repository.seed(seeded);
      const useCase = new TransitionConversationStateUseCase(repository);
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

      await expect(useCase.execute("tenant-1", "conv-1", "identifying")).rejects.toThrow(
        ConversationAlreadyEndedError,
      );
    });
  });
});
