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

  /**
   * v11: a preemptive rule, not a live-observed bug — real conversations
   * run against claude-haiku-4-5 for this pass never actually produced
   * these openers, but they're exactly the kind of canned-enthusiasm
   * tic this platform is built to avoid (§5's own anti-robotic
   * philosophy), and the prior "sound natural" instruction never named
   * them explicitly.
   */
  it("explicitly names stock enthusiasm openers to avoid, not just a general 'sound natural' instruction", () => {
    expect(PLATFORM_BASE_PROMPT_V1).toContain('"Absolutely!"');
    expect(PLATFORM_BASE_PROMPT_V1).toContain('"Certainly!"');
    expect(PLATFORM_BASE_PROMPT_V1).toContain('"Great question!"');
  });

  /**
   * v12, from a real CSR-training transcript analysis: let the caller
   * explain why they're calling before asking logistics questions —
   * the training material's own "interrogation" anti-pattern, and a
   * generalization of the same over-confirming/robotic-flow philosophy
   * v3/v9/v11 already encode for other specific cases.
   */
  it("instructs the model to let the caller explain before asking logistics questions", () => {
    expect(PLATFORM_BASE_PROMPT_V1.toLowerCase()).toContain(
      "let them finish before asking anything else",
    );
    expect(PLATFORM_BASE_PROMPT_V1.toLowerCase()).toContain(
      "feels like an interrogation, not a conversation",
    );
  });

  it("instructs the model to paraphrase the problem back with varied phrasing instead of a bare 'Okay'", () => {
    expect(PLATFORM_BASE_PROMPT_V1).toContain("paraphrase it back in your own words");
    expect(PLATFORM_BASE_PROMPT_V1.toLowerCase()).toContain('bare "okay" every time');
  });

  it("instructs the model to ask who the right point of contact is when someone besides the caller is involved, and confirm their info too", () => {
    expect(PLATFORM_BASE_PROMPT_V1.toLowerCase()).toContain(
      "ask who the right point of contact is",
    );
    expect(PLATFORM_BASE_PROMPT_V1.toLowerCase()).toContain("not just the caller's own");
  });

  it("instructs the model to recognize a second issue mentioned in passing as a real opportunity to help", () => {
    expect(PLATFORM_BASE_PROMPT_V1.toLowerCase()).toContain(
      "treat it as a real opportunity to help",
    );
  });

  /**
   * The training material's own most-emphasized distinction: agreeing
   * to a look-and-quote is a qualified opportunity, not a sold job.
   * The schema already had a value for this (`priority: "estimate"`)
   * that nothing previously told the model to actually use.
   */
  it('instructs the model to use priority "estimate" (not "routine") for a look-and-quote agreement, and describe it honestly as not-yet-committed work', () => {
    expect(PLATFORM_BASE_PROMPT_V1).toContain(
      'use priority "estimate" rather than "routine" when calling createLead',
    );
    expect(PLATFORM_BASE_PROMPT_V1.toLowerCase()).toContain("not a sold job");
  });

  it("instructs the model to document a future, not-yet-actionable opportunity without pressuring the caller", () => {
    expect(PLATFORM_BASE_PROMPT_V1.toLowerCase()).toContain("don't push");
    expect(PLATFORM_BASE_PROMPT_V1.toLowerCase()).toContain("fold it into the problem summary");
  });

  /**
   * The one piece of that same training material deliberately NOT
   * adopted: it has the CSR offering a specific appointment window,
   * which flatly contradicts this prompt's own "never schedule,
   * promise a specific appointment time" rule — there is no scheduling
   * integration to check real availability against. Confirms v12
   * didn't silently introduce a contradiction alongside its real fixes.
   */
  it("still never instructs the model to offer a specific appointment window — v12 did not reintroduce the scheduling promise this prompt forbids", () => {
    expect(PLATFORM_BASE_PROMPT_V1.toLowerCase()).not.toMatch(/\b(8 to 10|tomorrow morning)\b/);
    expect(PLATFORM_BASE_PROMPT_V1).toContain(
      "you never schedule, promise a specific appointment time",
    );
  });

  /**
   * v13, found immediately while verifying v12 against the real model:
   * the model repeated "I still need that Newcastle address though"
   * almost verbatim across five straight turns, never engaging with
   * anything the caller actually said in between, including a clear
   * close signal ("yes, that all sounds good, thank you"). A stricter,
   * count-based instruction was added — NOTE (see this file's own
   * follow-up real-model runs, not asserted here since this is a text
   * check, not a behavioral one): re-verifying this against the real
   * model afterward showed the instruction reduces but does NOT fully
   * eliminate the fixation — it's a genuine, still-open limitation of
   * prompt-only tuning for this specific model on this specific
   * failure mode, tracked honestly rather than claimed fixed. This
   * test only proves the instruction is present in the prompt text,
   * not that the model reliably follows it.
   */
  it("instructs the model to stop re-asking the same missing field after two attempts rather than repeating it indefinitely", () => {
    expect(PLATFORM_BASE_PROMPT_V1.toLowerCase()).toContain(
      "if you've now asked for the same piece of information twice",
    );
    expect(PLATFORM_BASE_PROMPT_V1.toLowerCase()).toContain("stop asking for it a third time");
  });

  /**
   * v14: the greeting never introduced the CSR by name at all — nothing
   * told the model to, even once a per-tenant name (DEFAULT_BRAND_VOICE_PROMPT)
   * existed to introduce. The instruction is deliberately CONDITIONAL
   * ("if you were given a name") since not every tenant will configure one.
   */
  it("instructs the model to introduce itself by name in the greeting when a name was given, and not invent one when it wasn't", () => {
    expect(PLATFORM_BASE_PROMPT_V1.toLowerCase()).toContain(
      "introduce yourself by it in your opening greeting",
    );
    expect(PLATFORM_BASE_PROMPT_V1.toLowerCase()).toContain("don't invent one");
  });

  /**
   * v14: playful personal questions ("how old are you," "what's your
   * birthday") are deliberately handled DIFFERENTLY from v8's "are you
   * human or AI" honesty rule — a warm deflection for banter, never a
   * fabricated fake age/birthday, and the absolute honesty rule stays
   * untouched for a genuinely serious version of the same question.
   */
  it("instructs the model to warmly deflect playful personal questions without fabricating a fake age or birthday, while keeping the serious human/AI honesty rule absolute", () => {
    expect(PLATFORM_BASE_PROMPT_V1.toLowerCase()).toContain("joking about your age or birthday");
    expect(PLATFORM_BASE_PROMPT_V1.toLowerCase()).toContain(
      "never invent a specific fake age, birthday, or personal history",
    );
    expect(PLATFORM_BASE_PROMPT_V1.toLowerCase()).toContain("always answer that one honestly");
  });

  /**
   * v14: closes the same class of gap v6/v8 already closed for failed
   * tool calls and unsubmitted leads (don't fill an honesty gap with a
   * confident-sounding fabrication) — this time for technical questions
   * the model itself isn't confident about.
   */
  it("instructs the model to defer an uncertain technical question to the technician rather than guessing", () => {
    expect(PLATFORM_BASE_PROMPT_V1.toLowerCase()).toContain("don't guess and don't make something");
    expect(PLATFORM_BASE_PROMPT_V1.toLowerCase()).toContain(
      "that's something the technician can confirm",
    );
  });

  /**
   * v14: a rare (not reliably reproducible — 1 occurrence in several
   * real-model runs, scripts/measure-conversation-quality.ts) but
   * serious artifact if it ever reaches a real call: the model wrote
   * "*[Calling escalateEmergency]*" as literal spoken response text,
   * which TTS would read aloud verbatim. A human CSR never narrates
   * their own internal process — this closes the gap cheaply even
   * without full reproducibility, matching the same "no visible seam"
   * philosophy the rest of this prompt is built on.
   */
  it("instructs the model never to narrate its own actions or internal process as spoken text (no stage directions)", () => {
    expect(PLATFORM_BASE_PROMPT_V1.toLowerCase()).toContain(
      "never narrate your own actions or internal process out loud",
    );
    expect(PLATFORM_BASE_PROMPT_V1.toLowerCase()).toContain("no visible seam between");
  });

  /**
   * v15: found live on a real call, then reproduced on demand — with
   * createCustomer's `address` field made optional (tool-catalog.ts,
   * the actual bug fix), the model's fixation didn't disappear, it moved
   * one field over: it started gating customer/lead capture on getting a
   * ZIP CODE first (to self-check service coverage), asked for it four
   * times in the same scenario that used to fixate on street address,
   * including once after a caller close signal. This rule names that
   * specific self-imposed gate directly.
   */
  it("instructs the model that service-area/coverage checking is never a prerequisite for creating the customer/lead", () => {
    expect(PLATFORM_BASE_PROMPT_V1.toLowerCase()).toContain(
      "checking whether an address is in your service area is a nice-to-have",
    );
    expect(PLATFORM_BASE_PROMPT_V1.toLowerCase()).toContain(
      "a name and phone number is enough on its own",
    );
  });

  /**
   * v15: v13's general "stop asking a third time" rule alone did not
   * reliably survive an explicit close signal in real-model testing —
   * the model asked for a zip code again immediately after the caller
   * said "yes, that all sounds good, thank you." This names that exact
   * case explicitly rather than relying on the general wording to cover it.
   */
  it("instructs the model to treat an explicit close signal as at least as strong as two redirects, and wrap up rather than asking the outstanding question again", () => {
    expect(PLATFORM_BASE_PROMPT_V1.toLowerCase()).toContain(
      "treat that as at least as strong as two redirects in a row",
    );
  });

  /**
   * v16: runtime-context.ts's own formatRuntimeContext already puts the
   * caller's phone number in front of the model on every call ("Caller
   * ANI: ... → searchCustomer already run: not yet run") specifically so
   * it can be used for an immediate lookup — but nothing ever told the
   * model that was the point, so the infrastructure existed with no
   * instruction connecting it to the "don't make a returning caller
   * repeat themselves" behavior the CSR-training pass is built around.
   */
  it("instructs the model to use the caller's own ANI for an immediate searchCustomer lookup instead of asking for their phone number from scratch", () => {
    expect(PLATFORM_BASE_PROMPT_V1.toLowerCase()).toContain(
      "call searchcustomer with it as one of your first actions",
    );
    expect(PLATFORM_BASE_PROMPT_V1.toLowerCase()).toContain(
      "instead of asking the caller to read their number out loud",
    );
  });

  /**
   * v16: named explicitly for the first time, even though the platform
   * base already avoided going silent in real-model testing — this
   * session's own real call logs and the QA mission's dead-air scenario
   * both surfaced "hello? / are you still there?" as a real, recurring
   * caller behavior worth a reliable, tested guarantee rather than an
   * incidental byproduct of other rules.
   */
  it("instructs the model to answer a 'hello? / are you still there?' check-in immediately, before continuing with anything else", () => {
    expect(PLATFORM_BASE_PROMPT_V1.toLowerCase()).toContain(
      "that always gets an immediate, direct",
    );
    expect(PLATFORM_BASE_PROMPT_V1.toLowerCase()).toContain(
      "never just repeat your previous question",
    );
  });

  /**
   * v16: v13's "stop asking a third time" rule covers a caller who
   * REDIRECTS away from a question; a caller who explicitly says "I
   * already told you" is making a different, stronger complaint — being
   * right and having it ignored — that calls for owning the mistake in
   * the response, not just silently dropping the question.
   */
  it("instructs the model to own it (not over-apologize or get defensive) when a caller says they already provided something", () => {
    expect(PLATFORM_BASE_PROMPT_V1.toLowerCase()).toContain('"i already told you that"');
    expect(PLATFORM_BASE_PROMPT_V1.toLowerCase()).toContain("\"you're right, i've got that\"");
  });

  /**
   * v16: generalizes v13's narrow "respond to a different FIELD the
   * caller answered instead" rule into the broader CSR-training "current
   * intent first" principle — a caller's own direct question (hours,
   * service area, pricing, anything with a real answer) always outranks
   * whatever the model itself was in the middle of asking.
   */
  it("instructs the model to answer a caller's direct question (hours, service area, pricing) before returning to its own line of questioning", () => {
    expect(PLATFORM_BASE_PROMPT_V1.toLowerCase()).toContain("a caller's own direct question");
    expect(PLATFORM_BASE_PROMPT_V1.toLowerCase()).toContain("is always the current priority");
  });

  /**
   * v17: found immediately while real-model-verifying v16's own
   * ANI-lookup addition — a direct test (a caller saying "it's Marcus
   * again" with real prior service history available via
   * lookupPreviousCalls) confirmed the tool was NEVER called even after
   * searchCustomer found a match. searchCustomer's own description says
   * "First tool called on every inbound call" — lookupPreviousCalls had
   * no equivalent trigger telling the model when to reach for it.
   */
  it("instructs the model to call lookupPreviousCalls immediately after searchCustomer finds an existing customer", () => {
    expect(PLATFORM_BASE_PROMPT_V1.toLowerCase()).toContain(
      "call lookuppreviouscalls for them right after",
    );
    expect(PLATFORM_BASE_PROMPT_V1.toLowerCase()).toContain(
      "a returning caller with a service history is exactly who that tool exists for",
    );
  });
});
