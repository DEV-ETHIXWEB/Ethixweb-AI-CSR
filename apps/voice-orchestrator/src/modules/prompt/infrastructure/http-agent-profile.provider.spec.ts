import { FakeCoreApiClient } from "../../capacity/infrastructure/__fakes__/fake-core-api-client";
import { DEFAULT_BRAND_VOICE_PROMPT, DEFAULT_LLM_MODEL } from "./static-agent-profile.provider";
import { HttpAgentProfileProvider } from "./http-agent-profile.provider";

const AI_KNOWLEDGE_PATH = "/internal/knowledge/business-1/ai-knowledge";

describe("HttpAgentProfileProvider", () => {
  it("happy path: folds approved ai-knowledge items into businessOverridePrompt, priority-ordered", async () => {
    const client = new FakeCoreApiClient();
    client.getResponses.set(AI_KNOWLEDGE_PATH, [
      {
        id: "item-2",
        category: "warranty",
        title: "Warranty",
        content: "1 year parts.",
        priority: 2,
      },
      {
        id: "item-1",
        category: "pricing",
        title: "Diagnostic fee",
        content: "$89, waived if hired.",
        priority: 0,
      },
    ]);
    const provider = new HttpAgentProfileProvider(client);

    const profile = await provider.getActiveProfile("tenant-1", "business-1");

    expect(profile.tenantId).toBe("tenant-1");
    expect(profile.businessId).toBe("business-1");
    expect(profile.llmModel).toBe(DEFAULT_LLM_MODEL);
    expect(profile.tenantDefaultPrompt).toBe(DEFAULT_BRAND_VOICE_PROMPT);
    // priority 0 item appears before priority 2 item.
    const first = profile.businessOverridePrompt.indexOf("Diagnostic fee");
    const second = profile.businessOverridePrompt.indexOf("Warranty");
    expect(first).toBeGreaterThan(-1);
    expect(second).toBeGreaterThan(first);
  });

  it("no approved ai-knowledge items: businessOverridePrompt is an empty string, not a header with nothing under it", async () => {
    const client = new FakeCoreApiClient();
    client.getResponses.set(AI_KNOWLEDGE_PATH, []);
    const provider = new HttpAgentProfileProvider(client);

    const profile = await provider.getActiveProfile("tenant-1", "business-1");

    expect(profile.businessOverridePrompt).toBe("");
  });

  it("core-api unreachable: falls back to an empty businessOverridePrompt, never throwing", async () => {
    const client = new FakeCoreApiClient();
    client.getFailures.set(AI_KNOWLEDGE_PATH, new Error("ECONNREFUSED"));
    const provider = new HttpAgentProfileProvider(client);

    const profile = await provider.getActiveProfile("tenant-1", "business-1");

    expect(profile.businessOverridePrompt).toBe("");
    expect(profile.tenantDefaultPrompt).toBe(DEFAULT_BRAND_VOICE_PROMPT);
  });
});
