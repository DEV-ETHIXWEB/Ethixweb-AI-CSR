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
    expect(PLATFORM_BASE_PROMPT_V1.toLowerCase()).toContain(
      "unavailable, errored, rejected, or degraded",
    );
    expect(PLATFORM_BASE_PROMPT_V1.toLowerCase()).toContain(
      "the caller should never hear that anything went wrong",
    );
  });

  /**
   * Regression coverage for a narrower live bug the v5 wording still let
   * through on a re-run of the same battery: a caller-given phone number
   * in the wrong format got rejected by tool-schema validation (a
   * different code path than a "degraded" execution), and the model
   * correctly self-corrected and retried — but said "Let me try that
   * again" out loud first. The instruction has to name the model's own
   * rejected arguments, not just external unavailability.
   */
  it("instructs the model to silently retry rejected arguments (e.g. bad phone format) rather than narrating the retry", () => {
    expect(PLATFORM_BASE_PROMPT_V1.toLowerCase()).toContain(
      "a tool rejecting arguments you supplied yourself",
    );
    expect(PLATFORM_BASE_PROMPT_V1.toLowerCase()).toContain('never say "let me try that again');
  });

  /**
   * Regression coverage for the most serious live finding of the whole
   * scenario battery: the same unambiguous "pipe burst ... flooding
   * fast" description, run 5 times against the real model, missed
   * calling escalateEmergency entirely on 1 of 5 runs — "If unsure ...
   * call escalateEmergency" gave the model an implicit excuse to skip
   * the tool whenever it already felt confident the case was obviously
   * urgent, exactly the case that was missed. The call has to be
   * unconditional, not gated on the model's own uncertainty.
   */
  it("instructs the model to ALWAYS call escalateEmergency before further questions, not only when unsure", () => {
    expect(PLATFORM_BASE_PROMPT_V1).not.toContain("If unsure whether something is an emergency");
    expect(PLATFORM_BASE_PROMPT_V1.toLowerCase()).toContain(
      "call escalateemergency before asking any further qualifying questions",
    );
    expect(PLATFORM_BASE_PROMPT_V1.toLowerCase()).toContain("even when it seems obviously urgent");
  });

  /**
   * Regression coverage for a real bug found live testing scenarios
   * beyond the original 8: asked directly "can I talk to a real
   * person," the model said "I'm a real person on the line with you" —
   * a direct misrepresentation, and exactly the gatekeeping docs/03 §6's
   * "Can I speak to someone?" row already says never to do.
   */
  it("instructs the model to never claim to be human, and to never gatekeep a transfer request", () => {
    expect(PLATFORM_BASE_PROMPT_V1.toLowerCase()).toContain("doesn't mean claiming to be human");
    expect(PLATFORM_BASE_PROMPT_V1.toLowerCase()).toContain(
      "say plainly that you're an automated assistant",
    );
    expect(PLATFORM_BASE_PROMPT_V1.toLowerCase()).toContain(
      "never gatekeep a transfer request with more qualifying questions",
    );
  });

  /**
   * Regression coverage for a real bug found live in a full
   * qualify-to-lead scenario: createCustomer never actually succeeded
   * (no CRM configured for the test business), so createLead was never
   * even reached, but the model still told the caller "let me get that
   * over to our team right now... they'll confirm timing" — a false
   * success claim. v6's "never narrate a failure" instruction closed off
   * honest failure language without saying what to say instead, and the
   * model filled the gap with false success, which is worse.
   */
  it("instructs the model to never claim createLead succeeded unless it actually did this call", () => {
    expect(PLATFORM_BASE_PROMPT_V1.toLowerCase()).toContain(
      "the same honesty rule applies to submitting the request itself",
    );
    expect(PLATFORM_BASE_PROMPT_V1.toLowerCase()).toContain(
      "after createlead has actually succeeded this call",
    );
  });

  /**
   * Regression coverage for a real live report: a caller said their full
   * name in one breath ("Akash Lakwhan") and the model still asked for a
   * last name — asking again for information already given is exactly
   * the over-confirming pattern this platform is built to avoid (§5's
   * own anti-pattern, previously only encoded for spelling, not for
   * whether a name was already complete).
   */
  it("instructs the model to treat a multi-word name as first+last together, and only ask again when just one word was given", () => {
    expect(PLATFORM_BASE_PROMPT_V1.toLowerCase()).toContain(
      "if they say two or more words in one breath",
    );
    expect(PLATFORM_BASE_PROMPT_V1.toLowerCase()).toContain(
      "don't ask for a last name separately, you already have it",
    );
    expect(PLATFORM_BASE_PROMPT_V1.toLowerCase()).toContain(
      "only ask for their last name specifically if they gave just one word",
    );
  });

  /**
   * v10, found by running real multi-turn conversations against the live
   * model (scripts/measure-conversation-quality.ts): given only a first
   * name, the model correctly understood a last name was still needed
   * but never actually asked for it when a more urgent-feeling
   * qualifying question came up instead — v9's rule only ever stated
   * the CONDITION for asking (one word vs. two-plus), never that
   * following through on the ask mattered. This is the priority
   * clarification that closes that gap.
   */
  it("instructs the model that an incomplete (first-name-only) name must still get followed up before the call ends, even if other questions come first", () => {
    expect(PLATFORM_BASE_PROMPT_V1.toLowerCase()).toContain(
      "make sure you actually circle back and get it before the call ends",
    );
    expect(PLATFORM_BASE_PROMPT_V1.toLowerCase()).toContain(
      "a lead with only a first name is an incomplete record",
    );
  });
});
