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
});
