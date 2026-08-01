import type { Conversation } from "../domain/conversation.entity";
import { ConversationNotFoundError } from "../domain/errors";
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
    startedAt: new Date().toISOString(),
    endedAt: null,
    endReason: null,
    ...overrides,
  };
}

describe("EndConversationUseCase", () => {
  it("marks the conversation ended, sets endReason, and publishes conversation.ended", async () => {
    const repository = new FakeConversationRepository();
    repository.seed(baseConversation());
    const eventBus = new FakeEventBus();
    const useCase = new EndConversationUseCase(repository, eventBus, createNoopLogger());

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
    const repository = new FakeConversationRepository();
    repository.seed(
      baseConversation({ endedAt: "2026-01-01T00:00:00.000Z", endReason: "first_reason" }),
    );
    const eventBus = new FakeEventBus();
    const useCase = new EndConversationUseCase(repository, eventBus, createNoopLogger());

    const result = await useCase.execute({
      tenantId: "tenant-1",
      conversationId: "conv-1",
      endReason: "second_reason",
    });

    expect(result.endReason).toBe("first_reason");
    expect(eventBus.eventsOfType("conversation.ended")).toHaveLength(0);
  });

  it("throws ConversationNotFoundError for an unknown conversation", async () => {
    const useCase = new EndConversationUseCase(
      new FakeConversationRepository(),
      new FakeEventBus(),
      createNoopLogger(),
    );

    await expect(
      useCase.execute({ tenantId: "tenant-1", conversationId: "missing", endReason: "x" }),
    ).rejects.toThrow(ConversationNotFoundError);
  });
});
