import { AssembleSystemPromptUseCase } from "../../prompt/application/assemble-system-prompt.use-case";
import type { AgentProfile, AgentProfileProvider } from "../../prompt/domain/agent-profile";
import { FakeCoreApiClient } from "../../tool-broker/application/__fakes__/fake-core-api-client";
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
  const coreApiClient = new FakeCoreApiClient();
  const provider: AgentProfileProvider = { getActiveProfile: async () => profile };
  const useCase = new StartConversationUseCase(
    repository,
    new AssembleSystemPromptUseCase(provider),
    eventBus,
    coreApiClient,
    createNoopLogger(),
  );
  return { useCase, repository, eventBus, coreApiClient };
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

  describe("production-blocker fix: POST /internal/calls before the conversation is created", () => {
    it("calls POST /internal/calls with the callId as telephonyCallSid, before creating the conversation", async () => {
      const { useCase, coreApiClient } = buildUseCase();

      await useCase.execute({
        tenantId: "tenant-1",
        businessId: "business-1",
        callId: "call-1",
        callerAni: "+15551234567",
      });

      expect(coreApiClient.postCalls).toHaveLength(1);
      expect(coreApiClient.postCalls[0]?.path).toBe("/internal/calls");
      expect(coreApiClient.postCalls[0]?.body).toMatchObject({
        businessId: "business-1",
        direction: "inbound",
        fromNumber: "+15551234567",
        telephonyCallSid: "call-1",
      });
    });

    it("passes toNumber through when supplied, defaulting to a placeholder when omitted", async () => {
      const { useCase, coreApiClient } = buildUseCase();

      await useCase.execute({
        tenantId: "tenant-1",
        businessId: "business-1",
        callId: "call-1",
        callerAni: "+15551234567",
        toNumber: "+15559876543",
      });

      expect(coreApiClient.postCalls[0]?.body).toMatchObject({ toNumber: "+15559876543" });
    });

    it("ORDERING GUARANTEE: does NOT create the conversation if the call-creation request fails", async () => {
      const { useCase, repository, coreApiClient } = buildUseCase();
      coreApiClient.failWith = new Error("core-api unreachable");

      await expect(
        useCase.execute({
          tenantId: "tenant-1",
          businessId: "business-1",
          callId: "call-1",
          callerAni: "+15551234567",
        }),
      ).rejects.toThrow("core-api unreachable");

      const found = await repository.findByCallId("tenant-1", "call-1");
      expect(found).toBeNull();
    });
  });
});
