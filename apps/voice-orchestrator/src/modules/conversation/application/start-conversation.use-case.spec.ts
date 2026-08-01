import { AssembleSystemPromptUseCase } from "../../prompt/application/assemble-system-prompt.use-case";
import type { AgentProfile, AgentProfileProvider } from "../../prompt/domain/agent-profile";
import { ConversationAlreadyExistsError } from "../domain/errors";
import { FakeConversationRepository } from "./__fakes__/fake-conversation-repository";
import { FakeEventBus } from "./__fakes__/fake-event-bus";
import { createNoopLogger } from "./__fakes__/fake-logger";
import { StartConversationUseCase } from "./start-conversation.use-case";

function fakeProfile(overrides: Partial<AgentProfile> = {}): AgentProfile {
  return {
    tenantId: "tenant-1",
    businessId: "business-1",
    version: 1,
    llmModel: "gpt-4o",
    tenantDefaultPrompt: "Brand voice: warm.",
    businessOverridePrompt: "",
    closingTemplate: "Bye.",
    businessName: "All Phase Plumbing",
    ...overrides,
  };
}

function buildUseCase(profile: AgentProfile = fakeProfile()) {
  const repository = new FakeConversationRepository();
  const eventBus = new FakeEventBus();
  const provider: AgentProfileProvider = { getActiveProfile: async () => profile };
  const useCase = new StartConversationUseCase(
    repository,
    new AssembleSystemPromptUseCase(provider),
    eventBus,
    createNoopLogger(),
  );
  return { useCase, repository, eventBus };
}

describe("StartConversationUseCase", () => {
  it("creates a conversation in the greeting state with an assembled system prompt and the profile's model", async () => {
    const { useCase, eventBus } = buildUseCase();

    const conversation = await useCase.execute({
      tenantId: "tenant-1",
      businessId: "business-1",
      callId: "call-1",
      callerAni: "+15551234567",
    });

    expect(conversation.state).toBe("greeting");
    expect(conversation.systemPrompt).toContain("Brand voice: warm.");
    expect(conversation.llmModel).toBe("gpt-4o");
    expect(conversation.messages).toEqual([]);
    expect(eventBus.eventsOfType("conversation.started")).toHaveLength(1);
  });

  it("throws ConversationAlreadyExistsError for a second conversation on the same call_id", async () => {
    const { useCase } = buildUseCase();
    const command = {
      tenantId: "tenant-1",
      businessId: "business-1",
      callId: "call-1",
      callerAni: "+15551234567",
    };
    await useCase.execute(command);

    await expect(useCase.execute(command)).rejects.toThrow(ConversationAlreadyExistsError);
  });
});
