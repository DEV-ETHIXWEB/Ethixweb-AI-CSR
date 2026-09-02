import { assembleLayeredPrompt, PLATFORM_BASE_PROMPT_V1 } from "./prompt-layers";

describe("assembleLayeredPrompt", () => {
  it("assembles all four layers in order, each under its own labeled section", () => {
    const result = assembleLayeredPrompt({
      platformBase: PLATFORM_BASE_PROMPT_V1,
      tenantDefault: "Brand voice: warm.",
      businessOverride: "Business name: All Phase Plumbing.",
      runtimeContext: "Current time: 2026-08-01T14:00:00 America/Chicago.",
    });

    const platformIndex = result.indexOf("[PLATFORM BASE");
    const tenantIndex = result.indexOf("[TENANT DEFAULT]");
    const businessIndex = result.indexOf("[BUSINESS OVERRIDE]");
    const runtimeIndex = result.indexOf("[RUNTIME CONTEXT]");
    expect(platformIndex).toBeGreaterThanOrEqual(0);
    expect(tenantIndex).toBeGreaterThan(platformIndex);
    expect(businessIndex).toBeGreaterThan(tenantIndex);
    expect(runtimeIndex).toBeGreaterThan(businessIndex);
    expect(result).toContain("never schedule");
    expect(result).toContain("Brand voice: warm.");
    expect(result).toContain("Business name: All Phase Plumbing.");
  });

  it("omits empty layers entirely rather than emitting an empty section", () => {
    const result = assembleLayeredPrompt({
      platformBase: PLATFORM_BASE_PROMPT_V1,
      tenantDefault: "",
      businessOverride: "   ",
      runtimeContext: "Current time: now.",
    });

    expect(result).not.toContain("[TENANT DEFAULT]");
    expect(result).not.toContain("[BUSINESS OVERRIDE]");
    expect(result).toContain("[RUNTIME CONTEXT]");
  });

  it("instructs the model to reflect escalateEmergency's decision in createLead's priority field — the only thing that actually drives a human notification's urgency (docs/07 §5.1)", () => {
    expect(PLATFORM_BASE_PROMPT_V1).toContain("createLead");
    expect(PLATFORM_BASE_PROMPT_V1).toContain('"emergency"');
    expect(PLATFORM_BASE_PROMPT_V1).toContain('"urgent"');
    expect(PLATFORM_BASE_PROMPT_V1).toContain("forward_call");
    expect(PLATFORM_BASE_PROMPT_V1).toContain("priority_notify");
  });

  /**
   * Regression coverage for a real bug found live against an actual
   * transcript: v2 of this prompt said "Always confirm spelled names ...
   * back to the caller" — an ordinary name got spelled back twice in one
   * response, exactly the "robotic, current HCP behavior this platform
   * must not repeat" docs/03 §5 itself already names as the anti-pattern.
   * v3 makes name-spelling conditional (uncommon/foreign/low-confidence
   * only) and explicitly bans repeating a confirmation already given.
   */
  it("makes name-spelling CONDITIONAL (uncommon/foreign/low-confidence), not an unconditional rule — the found-live HCP anti-pattern docs/03 §5 names", () => {
    expect(PLATFORM_BASE_PROMPT_V1).toContain("Only spell a name back");
    expect(PLATFORM_BASE_PROMPT_V1.toLowerCase()).toContain("uncommon");
    expect(PLATFORM_BASE_PROMPT_V1.toLowerCase()).toContain("low-confidence");
    expect(PLATFORM_BASE_PROMPT_V1).not.toContain("Always confirm spelled names");
  });

  it("instructs the model never to repeat an already-answered confirmation in the same response", () => {
    expect(PLATFORM_BASE_PROMPT_V1.toLowerCase()).toContain(
      "never ask for the same confirmation twice",
    );
  });

  it("instructs a brief human acknowledgment of real distress/active damage before moving to questions", () => {
    expect(PLATFORM_BASE_PROMPT_V1.toLowerCase()).toContain("upset, scared");
    expect(PLATFORM_BASE_PROMPT_V1.toLowerCase()).toContain("briefly");
  });

  /**
   * Regression coverage for a second real bug found live in the same
   * transcript: even with a correct (or incorrect) escalateEmergency
   * classification, the model told a caller mid-flood "this doesn't quite
   * meet our criteria for an immediate emergency dispatch" — announcing
   * the AI's own risk determination to a distressed caller is a real
   * liability/UX problem independent of whether the classification itself
   * was right.
   */
  it("instructs the model to never narrate escalateEmergency's own outcome/determination back to the caller", () => {
    expect(PLATFORM_BASE_PROMPT_V1.toLowerCase()).toContain(
      "never tell the caller your own read on how serious",
    );
  });

  /**
   * Regression coverage for a real capability gap closed alongside
   * DeepgramSttProvider's switch to multilingual code-switching mode
   * (language=multi) — Deepgram now transcribes the caller's actual
   * spoken language, but nothing in the prompt told the model it was
   * allowed to answer in anything but English.
   */
  it("instructs the model to speak whatever language the caller is speaking, not default to English", () => {
    expect(PLATFORM_BASE_PROMPT_V1).toContain("Speak whatever language the caller is speaking");
    expect(PLATFORM_BASE_PROMPT_V1).toContain("Spanish");
  });

  /**
   * Regression coverage for a real bug found live running a full scenario
   * battery: a degraded tool result (e.g. CRM lookup unavailable) had no
   * prompt guidance, and the model improvised "I'm having a quick
   * technical hiccup on my end" / "Let me try that again" mid-response —
   * narrating internal system trouble to the caller, the same family of
   * bug as never-narrate-escalateEmergency's-outcome, just for tool
   * failures instead of emergency classification.
   */
  it("instructs the model never to narrate a degraded/failed tool call to the caller", () => {
    expect(PLATFORM_BASE_PROMPT_V1.toLowerCase()).toContain("unavailable, errored, or degraded");
    expect(PLATFORM_BASE_PROMPT_V1.toLowerCase()).toContain(
      "the caller should never hear that anything went wrong",
    );
  });
});
