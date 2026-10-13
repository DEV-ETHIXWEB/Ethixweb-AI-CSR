import { AssembleSystemPromptUseCase } from "../../prompt/application/assemble-system-prompt.use-case";
import type { AgentProfile, AgentProfileProvider } from "../../prompt/domain/agent-profile";
import { FakeCoreApiClient } from "../../tool-broker/application/__fakes__/fake-core-api-client";
import { ConversationAlreadyExistsError } from "../domain/errors";
import { FakeAiProvider } from "./__fakes__/fake-ai-provider";
import { FakeCallAdmissionPort } from "./__fakes__/fake-call-admission";
import { FakeCapacityConfigProvider } from "./__fakes__/fake-capacity-config";
import { FakeConversationRepository } from "./__fakes__/fake-conversation-repository";
import { FakeEventBus } from "./__fakes__/fake-event-bus";
import { createNoopLogger } from "./__fakes__/fake-logger";
import { FakeTenantStatusProvider } from "./__fakes__/fake-tenant-status";
import { buildOpeningGreeting, StartConversationUseCase } from "./start-conversation.use-case";

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
  const aiProvider = new FakeAiProvider();
  const eventBus = new FakeEventBus();
  const coreApiClient = new FakeCoreApiClient();
  const callAdmission = new FakeCallAdmissionPort();
  const capacityConfig = new FakeCapacityConfigProvider();
  const tenantStatus = new FakeTenantStatusProvider();
  const provider: AgentProfileProvider = { getActiveProfile: async () => profile };
  const useCase = new StartConversationUseCase(
    repository,
    new AssembleSystemPromptUseCase(provider),
    eventBus,
    coreApiClient,
    callAdmission,
    capacityConfig,
    tenantStatus,
    createNoopLogger(),
  );
  return {
    useCase,
    repository,
    aiProvider,
    eventBus,
    coreApiClient,
    callAdmission,
    capacityConfig,
    tenantStatus,
  };
}

describe("StartConversationUseCase", () => {
  it("creates a conversation in the greeting state with an assembled system prompt and the profile's model", async () => {
    const { useCase, eventBus } = buildUseCase();

    const { conversation } = await useCase.execute({
      tenantId: "tenant-1",
      businessId: "business-1",
      callId: "call-1",
      callerAni: "+15551234567",
    });

    expect(conversation.state).toBe("greeting");
    expect(conversation.systemPrompt).toContain("Brand voice: warm.");
    expect(conversation.llmModel).toBe("gpt-4o");
    expect(eventBus.eventsOfType("conversation.started")).toHaveLength(1);
  });

  /**
   * Regression coverage for the most serious bug found this session: a
   * real live call connected successfully every single time but the AI
   * never spoke — docs/28 §J's documented call-start sequence never
   * included a greeting step at all, and every scripted scenario test
   * this session posted the caller's opening line as the first turn,
   * never exercising whether the AI spoke unprompted. Only a real phone
   * call exposed it. This proves the fix: call-start now runs one
   * non-tool completion and returns it as `greeting`, and the exchange
   * is durably saved into the conversation's own message history so the
   * caller's first real reply has continuity with what the AI already said.
   */
  it("opens with an instant scripted greeting naming Grace and the business, saved into history, with NO model call", async () => {
    const { useCase, aiProvider } = buildUseCase();

    const { conversation, greeting } = await useCase.execute({
      tenantId: "tenant-1",
      businessId: "business-1",
      callId: "call-1",
      callerAni: "+15551234567",
    });

    expect(greeting).toBe("Hi, this is Grace at All Phase Plumbing. What can I help you with?");
    expect(conversation.messages).toEqual([
      { role: "user", content: expect.stringContaining("The call has just connected") },
      { role: "assistant", content: greeting },
    ]);
    // The point of the change: pickup no longer waits on, or pays for, a
    // full completion of the ~10k-token prompt.
    expect(aiProvider.requests).toHaveLength(0);
  });

  it("still greets properly when the business name is unavailable, and never speaks a placeholder", () => {
    expect(buildOpeningGreeting(null)).toBe("Hi, this is Grace. What can I help you with?");
    expect(buildOpeningGreeting("   ")).toBe("Hi, this is Grace. What can I help you with?");
    expect(buildOpeningGreeting("All Phase Plumbing")).not.toMatch(/\[|\]/);
  });

  it("speaks the company name without the branch label the business record carries", () => {
    expect(buildOpeningGreeting("All Phase Plumbing — Main Office")).toBe(
      "Hi, this is Grace at All Phase Plumbing. What can I help you with?",
    );
    expect(buildOpeningGreeting("Acme Drains - Tacoma")).toBe(
      "Hi, this is Grace at Acme Drains. What can I help you with?",
    );
    // A hyphen INSIDE a name is not a branch separator.
    expect(buildOpeningGreeting("Rock-Solid Plumbing")).toBe(
      "Hi, this is Grace at Rock-Solid Plumbing. What can I help you with?",
    );
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

      // Exactly one call record, now alongside the pre-greeting customer lookup.
      expect(coreApiClient.postCalls.filter((c) => c.path === "/internal/calls")).toHaveLength(1);
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

  describe("docs/15 §2: tenant-status gate", () => {
    it("proceeds normally for a serviceable tenant status (active)", async () => {
      const { useCase, coreApiClient, tenantStatus } = buildUseCase();
      tenantStatus.status = "active";

      await useCase.execute({
        tenantId: "tenant-1",
        businessId: "business-1",
        callId: "call-1",
        callerAni: "+15551234567",
      });

      // Exactly one call record, now alongside the pre-greeting customer lookup.
      expect(coreApiClient.postCalls.filter((c) => c.path === "/internal/calls")).toHaveLength(1);
    });

    it("throws TenantNotServiceableError and never reserves capacity or calls POST /internal/calls when the tenant is suspended", async () => {
      const { useCase, coreApiClient, callAdmission, tenantStatus } = buildUseCase();
      tenantStatus.status = "suspended";
      const reserveSpy = jest.spyOn(callAdmission, "reserve");

      await expect(
        useCase.execute({
          tenantId: "tenant-1",
          businessId: "business-1",
          callId: "call-1",
          callerAni: "+15551234567",
        }),
      ).rejects.toMatchObject({ name: "TenantNotServiceableError", status: "suspended" });

      expect(reserveSpy).not.toHaveBeenCalled();
      expect(coreApiClient.postCalls).toHaveLength(0);
    });

    it("still rejects an archived tenant (an INFERRED extension of docs/15's explicit 'suspended' case — see tenant-status.port.ts's own comment)", async () => {
      const { useCase, tenantStatus } = buildUseCase();
      tenantStatus.status = "archived";

      await expect(
        useCase.execute({
          tenantId: "tenant-1",
          businessId: "business-1",
          callId: "call-1",
          callerAni: "+15551234567",
        }),
      ).rejects.toMatchObject({ name: "TenantNotServiceableError", status: "archived" });
    });

    it("still admits a past_due tenant — the documented grace period BEFORE suspension, not itself call-blocking", async () => {
      const { useCase, coreApiClient, tenantStatus } = buildUseCase();
      tenantStatus.status = "past_due";

      await useCase.execute({
        tenantId: "tenant-1",
        businessId: "business-1",
        callId: "call-1",
        callerAni: "+15551234567",
      });

      // Exactly one call record, now alongside the pre-greeting customer lookup.
      expect(coreApiClient.postCalls.filter((c) => c.path === "/internal/calls")).toHaveLength(1);
    });
  });

  describe("docs/36: capacity admission gate", () => {
    it("reserves capacity BEFORE calling POST /internal/calls, and stores the reservationId on the conversation", async () => {
      const { useCase, coreApiClient } = buildUseCase();

      const { conversation } = await useCase.execute({
        tenantId: "tenant-1",
        businessId: "business-1",
        callId: "call-1",
        callerAni: "+15551234567",
      });

      expect(conversation.capacityReservationId).toBeTruthy();
      // Exactly one call record, now alongside the pre-greeting customer lookup.
      expect(coreApiClient.postCalls.filter((c) => c.path === "/internal/calls")).toHaveLength(1);
    });

    it("throws CapacityExceededError and never calls POST /internal/calls when the tenant is at its concurrency ceiling", async () => {
      const { useCase, coreApiClient, callAdmission } = buildUseCase();
      callAdmission.forceExhausted = "tenant";

      await expect(
        useCase.execute({
          tenantId: "tenant-1",
          businessId: "business-1",
          callId: "call-1",
          callerAni: "+15551234567",
        }),
      ).rejects.toMatchObject({ name: "CapacityExceededError", scope: "tenant" });

      expect(coreApiClient.postCalls).toHaveLength(0);
    });

    it("RESERVATION LEAK GUARD: releases the reservation if POST /internal/calls fails after admission succeeded", async () => {
      const { useCase, coreApiClient, callAdmission } = buildUseCase();
      coreApiClient.failWith = new Error("core-api unreachable");

      await expect(
        useCase.execute({
          tenantId: "tenant-1",
          businessId: "business-1",
          callId: "call-1",
          callerAni: "+15551234567",
        }),
      ).rejects.toThrow("core-api unreachable");

      const counts = await callAdmission.getActiveCounts("tenant-1");
      expect(counts.tenantActive).toBe(0);
      expect(counts.globalActive).toBe(0);
    });

    it("passes isEmergencyPriority through to the admission port", async () => {
      const { useCase, callAdmission } = buildUseCase();
      const reserveSpy = jest.spyOn(callAdmission, "reserve");

      await useCase.execute({
        tenantId: "tenant-1",
        businessId: "business-1",
        callId: "call-1",
        callerAni: "+15551234567",
        isEmergencyPriority: true,
      });

      expect(reserveSpy).toHaveBeenCalledWith(
        "tenant-1",
        "business-1",
        expect.objectContaining({ isEmergencyPriority: true }),
      );
    });

    it("defaults isEmergencyPriority to false when omitted", async () => {
      const { useCase, callAdmission } = buildUseCase();
      const reserveSpy = jest.spyOn(callAdmission, "reserve");

      await useCase.execute({
        tenantId: "tenant-1",
        businessId: "business-1",
        callId: "call-1",
        callerAni: "+15551234567",
      });

      expect(reserveSpy).toHaveBeenCalledWith(
        "tenant-1",
        "business-1",
        expect.objectContaining({ isEmergencyPriority: false }),
      );
    });
  });

  describe("caller lookup before the greeting (removes a model round trip from turn one)", () => {
    const command = {
      tenantId: "tenant-1",
      businessId: "business-1",
      callId: "call-1",
      callerAni: "+15551234567",
    };

    it("resolves a returning caller once, marks the lookup done, and carries the customer id", async () => {
      const { useCase, coreApiClient } = buildUseCase();
      coreApiClient.postResponses.set("/internal/customers/resolve", {
        id: "cust-9",
        name: "Larry",
      });

      const { conversation } = await useCase.execute(command);

      const lookups = coreApiClient.postCalls.filter(
        (c) => c.path === "/internal/customers/resolve",
      );
      expect(lookups).toHaveLength(1);
      expect(lookups[0]?.body).toEqual({ businessId: "business-1", phoneE164: "+15551234567" });
      expect(conversation.searchCustomerEverChecked).toBe(true);
      expect(conversation.customerId).toBe("cust-9");
      expect(conversation.systemPrompt).toContain("name on file: Larry");
      expect(conversation.systemPrompt).toContain("no service address on file");
      expect(conversation.systemPrompt).toContain("cust-9");
    });

    it("CLIENT FEEDBACK (2026-10-13): an 'unknown' record with no address makes Grace run the full intake and save, never skip it", async () => {
      const { useCase, coreApiClient } = buildUseCase();
      coreApiClient.postResponses.set("/internal/customers/resolve", {
        id: "cust-7",
        name: "unknown",
        address: null,
      });

      const { conversation } = await useCase.execute(command);

      expect(conversation.customerId).toBe("cust-7");
      expect(conversation.systemPrompt).toContain("Treat this caller as new");
      expect(conversation.systemPrompt).toContain("call createCustomer, which updates this record");
      expect(conversation.systemPrompt).toContain("Never say you already have their information");
      expect(conversation.systemPrompt).not.toContain("do not call createCustomer");
    });

    it("a complete record on file is confirmed with the caller, not assumed", async () => {
      const { useCase, coreApiClient } = buildUseCase();
      coreApiClient.postResponses.set("/internal/customers/resolve", {
        id: "cust-8",
        name: "Patrick Lee",
        address: { street: "1912 9th Ave W", city: "Seattle", state: "WA", zip: "98119" },
      });

      const { conversation } = await useCase.execute(command);

      expect(conversation.systemPrompt).toContain(
        "a customer is on file for this number: Patrick Lee, 1912 9th Ave W, Seattle, WA 98119",
      );
      expect(conversation.systemPrompt).toContain("Am I speaking with Patrick Lee?");
      expect(conversation.systemPrompt).toContain("it updates this record");
    });

    it("tells the model a new caller has no match, and still marks the lookup done", async () => {
      const { useCase, coreApiClient } = buildUseCase();
      coreApiClient.postResponses.set("/internal/customers/resolve", null);

      const { conversation } = await useCase.execute(command);

      expect(conversation.searchCustomerEverChecked).toBe(true);
      expect(conversation.customerId ?? null).toBeNull();
      expect(conversation.systemPrompt).toContain("no match found");
    });

    it("never greets a placeholder name like 'Caller' as if it were real", async () => {
      const { useCase, coreApiClient } = buildUseCase();
      coreApiClient.postResponses.set("/internal/customers/resolve", {
        id: "cust-1",
        name: "Caller",
      });

      const { conversation } = await useCase.execute(command);

      expect(conversation.systemPrompt).not.toContain("name on file: Caller");
      expect(conversation.systemPrompt).toContain("no name and service address on file");
    });

    it("degrades to the old behaviour when the lookup fails: nothing marked, model looks up itself", async () => {
      const { useCase, coreApiClient } = buildUseCase();
      const originalPost = coreApiClient.post.bind(coreApiClient);
      coreApiClient.post = async (path: string, body: unknown) => {
        if (path === "/internal/customers/resolve") {
          throw new Error("core-api down");
        }
        return originalPost(path, body);
      };

      const { conversation } = await useCase.execute(command);

      expect(conversation.searchCustomerEverChecked).toBeFalsy();
      expect(conversation.systemPrompt).toContain("not yet run");
    });
  });
});
