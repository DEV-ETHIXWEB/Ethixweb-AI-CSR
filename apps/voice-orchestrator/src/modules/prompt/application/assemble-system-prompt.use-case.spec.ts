import type { AgentProfile, AgentProfileProvider } from "../domain/agent-profile";
import type { RuntimeContext } from "../domain/runtime-context";
import { AssembleSystemPromptUseCase } from "./assemble-system-prompt.use-case";

function fakeProfile(overrides: Partial<AgentProfile> = {}): AgentProfile {
  return {
    tenantId: "tenant-1",
    businessId: "business-1",
    version: 1,
    llmModel: "gpt-4o",
    tenantDefaultPrompt: "Brand voice: warm.",
    businessOverridePrompt: "Business name: All Phase Plumbing.",
    closingTemplate: "Bye {{callerName}}.",
    businessName: "All Phase Plumbing",
    ...overrides,
  };
}

function fakeProvider(profile: AgentProfile): AgentProfileProvider {
  return { getActiveProfile: async () => profile };
}

function baseRuntimeContext(): RuntimeContext {
  return {
    currentTimeIso: "2026-08-01T14:00:00-05:00",
    timezone: "America/Chicago",
    businessHours: { isOpen: true, isHoliday: false },
    callerAni: "+15551234567",
    existingCustomerMatch: { found: false },
  };
}

describe("AssembleSystemPromptUseCase", () => {
  it("assembles the system prompt from the resolved profile and runtime context", async () => {
    const profile = fakeProfile();
    const useCase = new AssembleSystemPromptUseCase(fakeProvider(profile));

    const result = await useCase.execute("tenant-1", "business-1", baseRuntimeContext());

    expect(result.systemPrompt).toContain("Brand voice: warm.");
    expect(result.systemPrompt).toContain("Business name: All Phase Plumbing.");
    expect(result.systemPrompt).toContain("Caller ANI: +15551234567");
    expect(result.profile).toBe(profile);
  });

  it("renders an honest 'unknown' business-hours line when the lookup is unavailable, never a guessed default", async () => {
    const useCase = new AssembleSystemPromptUseCase(fakeProvider(fakeProfile()));

    const result = await useCase.execute("tenant-1", "business-1", {
      ...baseRuntimeContext(),
      businessHours: null,
    });

    expect(result.systemPrompt).toContain("Business hours: unknown");
    expect(result.systemPrompt).toContain("treat conservatively as after-hours");
  });
});
