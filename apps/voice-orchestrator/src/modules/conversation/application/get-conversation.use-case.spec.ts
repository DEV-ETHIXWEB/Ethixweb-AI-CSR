import type { Conversation } from "../domain/conversation.entity";
import { ConversationNotFoundError } from "../domain/errors";
import { FakeConversationRepository } from "./__fakes__/fake-conversation-repository";
import { GetConversationUseCase } from "./get-conversation.use-case";

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

describe("GetConversationUseCase", () => {
  it("returns the conversation for the caller's own tenant", async () => {
    const repository = new FakeConversationRepository();
    repository.seed(baseConversation());
    const useCase = new GetConversationUseCase(repository);

    const conversation = await useCase.execute("tenant-1", "conv-1");

    expect(conversation.id).toBe("conv-1");
  });

  it("throws ConversationNotFoundError for another tenant's conversation (tenant isolation)", async () => {
    const repository = new FakeConversationRepository();
    repository.seed(baseConversation());
    const useCase = new GetConversationUseCase(repository);

    await expect(useCase.execute("tenant-2", "conv-1")).rejects.toThrow(ConversationNotFoundError);
  });
});
