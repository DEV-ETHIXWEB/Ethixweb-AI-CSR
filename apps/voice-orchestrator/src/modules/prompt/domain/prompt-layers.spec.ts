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
   * v24 SUPERSEDES v3 here: v3's own real finding (an ordinary name
   * spelled back TWICE in one response, on a real call) is still
   * respected — spell it back only ONCE, never repeat an already-
   * confirmed spelling — but the product owner explicitly asked, twice,
   * for every name (not just uncommon/foreign/low-confidence ones) to be
   * spelled back to confirm it, prioritizing accuracy on the real
   * customer record. v3's own "Only spell a name back when..." CONDITION
   * is gone; the "don't repeat an already-confirmed spelling" discipline
   * survives as the new rule's own "exactly once per name" wording.
   */
  it("spells EVERY caller name back once to confirm it, delivered naturally, never repeated after it's confirmed", () => {
    const prompt = PLATFORM_BASE_PROMPT_V1.toLowerCase();
    expect(prompt).toContain("always spell a caller's name back letter by letter once");
    expect(prompt).toContain("whether it looks ordinary or not");
    expect(prompt).toContain("don't spell it back again later in the same call");
    expect(PLATFORM_BASE_PROMPT_V1).not.toContain("Only spell a name back");
  });

  /**
   * Same v24 direction change, for numbers: a caller-given zip code,
   * phone number, or street number is now always read back digit by
   * digit, even if the caller said it as one whole number rather than
   * spelling it out themselves — previously conditional on how the
   * caller themselves said it ("especially digit by digit").
   */
  it("reads EVERY zip code/phone/street number back digit by digit to confirm it, even when the caller said it as one whole number", () => {
    const prompt = PLATFORM_BASE_PROMPT_V1.toLowerCase();
    expect(prompt).toContain(
      "always read a zip code, phone number, or street number back digit by",
    );
    expect(prompt).toContain("even if the caller said the whole number naturally");
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
  /**
   * v29 NARROWS this rule rather than dropping it: circling back for a
   * missing last name is still instructed, but it may no longer become a
   * blocking gate. The original "a lead with only a first name is an
   * incomplete record" wording is deliberately GONE — paired with
   * tool-catalog.ts's `name.last` being required, it deadlocked two real
   * calls (one captured nothing at all, one fabricated
   * {first:"Gary", last:"Gary"}). See PLATFORM_BASE_PROMPT_VERSION's own
   * v29 comment.
   */
  it("still instructs circling back for a first-name-only caller, but ONCE and never as a blocker", () => {
    const prompt = PLATFORM_BASE_PROMPT_V1.toLowerCase();
    expect(prompt).toContain("do circle back for it before the call ends");
    expect(prompt).toContain("ask once, though");
    expect(prompt).toContain("submit with the first name alone and move on");
    expect(prompt).toContain("never invent one or repeat their first name into the");
    // The old wording made the gap itself sound disqualifying, which is
    // exactly what the model acted on when it fabricated a last name.
    expect(prompt).not.toContain("a lead with only a first name is an incomplete record");
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
   * v22 SUPERSEDES v14 here: a real caller's own on-call feedback asked
   * for the opposite of v14's "deflect" instruction — answer a
   * configured persona fact (gender presentation, persona age,
   * persona birthday) naturally and consistently, only deflecting a
   * fact that genuinely isn't configured. The absolute human/AI
   * honesty rule (v8, unchanged) still stays untouched for a genuinely
   * serious version of that question — answering a persona fact is
   * never a substitute for it.
   */
  it("instructs the model to answer a CONFIGURED persona fact naturally and consistently, deflect only an unconfigured one, while keeping the serious human/AI honesty rule absolute", () => {
    expect(PLATFORM_BASE_PROMPT_V1.toLowerCase()).toContain(
      "answer questions about it naturally and consistently",
    );
    expect(PLATFORM_BASE_PROMPT_V1.toLowerCase()).toContain(
      "if a particular fact isn't given, that's fine too",
    );
    expect(PLATFORM_BASE_PROMPT_V1.toLowerCase()).toContain(
      "the human-or-ai honesty rule above, which stays absolute and unconditional",
    );
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

  /**
   * v18: found live on a real ~7-minute phone call — asked "are you guys
   * available for like after one hour" (a direct question) and the model
   * silently pivoted straight to asking for a zip code, never
   * acknowledging the question existed. v17's "direct question is always
   * the priority" rule only covered questions with a real answer
   * available; nothing told the model to at least acknowledge one it
   * genuinely can't answer (live scheduling) instead of acting like it
   * was never asked.
   */
  it("instructs the model to acknowledge a direct question honestly even when it has no real answer, rather than silently skipping it", () => {
    expect(PLATFORM_BASE_PROMPT_V1.toLowerCase()).toContain(
      "still gets acknowledged, not silently skipped",
    );
    expect(PLATFORM_BASE_PROMPT_V1.toLowerCase()).toContain(
      "never just pivot straight to your own next question as if a direct question wasn't asked at all",
    );
  });

  /**
   * v18: found on the SAME real call — the caller spelled a zip code
   * digit by digit ("one double zero one eight," a likely STT
   * misheard/garbled transcript) and the model confidently read it back
   * as a DIFFERENT, cleaner-looking real zip ("98018 — got it"), which
   * the caller then had to correct. A second live attempt at the same
   * scenario produced a different failure instead — silently dropping
   * the garbled digits rather than guessing — same root gap: nothing
   * told the model to read a spoken number back for explicit
   * confirmation before treating it as final.
   */
  it("instructs the model to read back a spoken number for confirmation rather than guessing or silently dropping unclear digits", () => {
    expect(PLATFORM_BASE_PROMPT_V1.toLowerCase()).toContain(
      "always read a zip code, phone number, or street number back digit by",
    );
    expect(PLATFORM_BASE_PROMPT_V1.toLowerCase()).toContain(
      "never silently substitute a different, more 'normal-looking' number",
    );
    expect(PLATFORM_BASE_PROMPT_V1.toLowerCase()).toContain(
      "never just drop unclear digits and move on without asking again",
    );
  });

  /**
   * v19: found on a real ~21-minute call — Grace said "I'm getting your
   * information to the team now" (turn 73) and no createCustomer or
   * createLead call ever actually fired for that call. Confirmed against
   * the database: zero customer/lead rows exist for it.
   */
  it("forbids claiming the caller's info was sent to the team unless createCustomer/createLead is actually being called that same turn", () => {
    expect(PLATFORM_BASE_PROMPT_V1.toLowerCase()).toContain(
      "unless you are calling createcustomer",
    );
    expect(PLATFORM_BASE_PROMPT_V1.toLowerCase()).toContain(
      "don't say the sentence that implies you just did",
    );
  });

  /**
   * v19: found on the SAME real call — the caller gave a name at turn 6
   * and always had a real Caller ANI on file, yet Grace spent the entire
   * rest of a 21-minute call chasing zip code and street address instead
   * of calling createCustomer with what she already had — the same
   * "self-imposed constraint" pattern v15 already named, resurfacing on
   * a fresh field.
   */
  it("instructs the model that a name plus the caller's own ANI is enough to call createCustomer immediately, not something to defer until address/zip are settled", () => {
    expect(PLATFORM_BASE_PROMPT_V1.toLowerCase()).toContain(
      "that's genuinely enough to call createcustomer",
    );
    expect(PLATFORM_BASE_PROMPT_V1.toLowerCase()).toContain(
      "don't keep collecting address, zip code, or anything",
    );
  });

  /**
   * v20: the "sound like a human CSR" delivery pass. The bracket-tag
   * vocabulary here MUST stay in sync with voice-runtime's own
   * emotional-delivery.ts EMOTION_PROFILES keys — a word the prompt
   * names that the parser doesn't recognize gets silently stripped with
   * no delivery effect (safe, but pointless); this test is the one place
   * that would catch the two drifting apart.
   */
  it("teaches the model the exact supported [bracket] emotional-delivery cue vocabulary, and that cues are never spoken aloud", () => {
    const prompt = PLATFORM_BASE_PROMPT_V1.toLowerCase();
    expect(prompt).toContain("instructions for the phone system's voice engine only");
    expect(prompt).toContain("never words to say out loud");
    for (const cue of [
      "sincere",
      "warmly",
      "softly",
      "serious",
      "curious",
      "thoughtful",
      "confident",
      "frustrated",
      "tired",
      "gentle",
      "reassuring",
      "concerned",
      "relieved",
      "building",
      "slower",
      "calm",
      "sighs",
      "pause",
    ]) {
      expect(prompt).toContain(cue);
    }
  });

  it("tells the model to use delivery cues sparingly, matched to context, never on every sentence", () => {
    expect(PLATFORM_BASE_PROMPT_V1.toLowerCase()).toContain("most sentences need no cue at all");
    expect(PLATFORM_BASE_PROMPT_V1.toLowerCase()).toContain(
      "a cue on every sentence reads as fake",
    );
  });

  it("instructs one-idea-per-turn response shape: acknowledge, respond, at most one next step — not a stacked list of questions or an over-explanation", () => {
    const prompt = PLATFORM_BASE_PROMPT_V1.toLowerCase();
    expect(prompt).toContain("keep each response to one real idea");
    expect(prompt).toContain("never stack multiple questions in");
    expect(prompt).toContain("detail nobody asked for");
  });

  /**
   * v21, C1: a real forensic call found the model's ENTIRE output for one
   * turn was the literal 7-character string "[pause]" — no words at all,
   * ~12 seconds of silence immediately before the caller said "i'm just
   * pissed right now." Nothing previously told the model a cue must
   * accompany real words, only how to use one correctly.
   */
  it("instructs the model that a delivery cue can never BE the entire response — it must always accompany real words", () => {
    const prompt = PLATFORM_BASE_PROMPT_V1.toLowerCase();
    expect(prompt).toContain("a delivery cue can shape a sentence, but it can never be the");
    expect(prompt).toContain('a response of just "[pause]"');
  });

  /**
   * v21, C3: the same real call had `createCustomer` fail twice (no CRM
   * integration configured), and Grace told the caller twice anyway that
   * "a team member will call you back" — confirmed false against the
   * conversation record itself (`leadId` stayed null the whole call).
   * `handle-turn.use-case.ts`'s own `crmIntegrationUnavailable` flag
   * injects the exact runtime marker this rule is keyed to
   * ("this business's CRM/lead system is flagged as unavailable this
   * call") — see that file's own `annotateCrmUnavailable`.
   */
  it("instructs the model never to promise a callback/follow-up once the CRM/lead system is flagged unavailable this call", () => {
    const prompt = PLATFORM_BASE_PROMPT_V1.toLowerCase();
    expect(prompt).toContain("crm/lead system is flagged as unavailable this call");
    expect(prompt).toContain("never tell the caller a team member will call them back");
    expect(prompt).toContain("not able to submit this from your end right now");
  });

  /**
   * v22: a real caller asked "can I speak to a human," and Grace said
   * "I can connect you with someone" — but no real non-emergency
   * live-transfer mechanism exists (`forward_call` is
   * escalateEmergency-only), making that line the same class of
   * overpromise v21's CRM-callback rule already bans, just for a live
   * transfer instead of a lead submission.
   */
  it("instructs the model never to claim it's connecting the caller to a human unless a real transfer is happening this same turn", () => {
    const prompt = PLATFORM_BASE_PROMPT_V1.toLowerCase();
    expect(prompt).toContain("only say you're connecting them right now if a real transfer");
    expect(prompt).toContain('don\'t say "let me connect you" or promise someone will call them');
  });

  /**
   * v23: found live via a real-Anthropic full-stack audit (no live
   * call), running the SAME forward_call emergency scenario twice — the
   * model told the caller "Stay on the line... a technician is being
   * dispatched to you now... you'll hear back shortly with arrival
   * details," all stated as settled fact, for a real Twilio transfer
   * that executes entirely in voice-runtime AFTER the turn finishes and
   * can fail (the same audit found and fixed a real bug where a failed
   * transfer left the caller in silence with no fallback — see
   * call-session-orchestrator.ts's own executeEmergencyTransfer
   * comment). If the model has already promised a dispatched technician
   * before a failed transfer's own honest fallback ever reaches the
   * caller, that's a confusing, credibility-damaging reversal at
   * exactly the worst moment — a real emergency.
   */
  it("instructs the model never to state a forward_call transfer as settled fact — it doesn't control or witness whether the real transfer succeeds", () => {
    const prompt = PLATFORM_BASE_PROMPT_V1.toLowerCase();
    expect(prompt).toContain("you do not control or witness whether the actual transfer succeeds");
    expect(prompt).toContain('not "stay on the line,"');
    expect(prompt).toContain("a technician is being");
    expect(prompt).toContain("you'll hear back shortly with arrival");
  });

  describe("v22 — social intelligence / consultative-marketing / boundary-setting personality (real-call feedback + product spec)", () => {
    it("states the explicit priority order — emergency/safety and helping the caller always outrank personality/marketing", () => {
      const prompt = PLATFORM_BASE_PROMPT_V1.toLowerCase();
      expect(prompt).toContain("priority order when things pull in different directions");
      expect(prompt).toContain("emergency or safety first");
      expect(prompt).toContain("helping them wins, every time");
    });

    it("instructs natural social mirroring without profiling, and following up on what the caller just said rather than jumping to the next form field", () => {
      const prompt = PLATFORM_BASE_PROMPT_V1.toLowerCase();
      expect(prompt).toContain("never infer or comment on sensitive traits");
      expect(prompt).toContain("never make a judgment about someone based on what they share");
      expect(prompt).toContain("a real conversation has a thread, a questionnaire doesn't");
    });

    /**
     * Found live via real-Anthropic verification (measure-grace-persona.ts
     * scenario A): a caller stating their own age right after asking
     * Grace's got a flat "Nice." straight into the next question — safe,
     * but not the warm, bantering social-mirroring moment the mission's
     * own example describes. Cheap, targeted addition, not a rewrite of
     * the whole social-intelligence section.
     */
    it("instructs a warm, specific reaction when the caller states their OWN age, not a flat acknowledgment straight into the next question", () => {
      const prompt = PLATFORM_BASE_PROMPT_V1.toLowerCase();
      expect(prompt).toContain("if a caller states their own age");
      expect(prompt).toContain("you've got a few years on grace then");
    });

    /**
     * Product spec: calm, confident, occasionally lightly witty
     * boundary-setting for abuse — never retaliation, never a long
     * lecture, never ending the call over rudeness alone; a genuine
     * safety escalation (threats/harassment) is explicitly carved out
     * as a DIFFERENT case wit doesn't apply to.
     */
    it("instructs calm, non-hostile boundary-setting for abuse — never retaliation — with a genuine safety escalation carved out separately", () => {
      const prompt = PLATFORM_BASE_PROMPT_V1.toLowerCase();
      expect(prompt).toContain("never get angry, never insult back, never threaten them");
      expect(prompt).toContain("i can handle the frustration");
      expect(prompt).toContain("genuine threats, harassment, or unsafe content");
      expect(prompt).toContain("de-escalate plainly and disengage rather than reaching for wit");
    });

    it("instructs warm, brief handling of harmless compliments/flirting, with an explicit ban on sexual content or claiming real romantic feelings", () => {
      const prompt = PLATFORM_BASE_PROMPT_V1.toLowerCase();
      expect(prompt).toContain("well, thank you");
      expect(prompt).toContain("never encourage anything sexual or explicit");
      expect(prompt).toContain("never claim real romantic feelings");
      expect(prompt).toContain("one light, warm line is enough, not an extended back-and-forth");
    });

    it("instructs a brief, non-salesy business introduction for an accidental/wrong-number caller", () => {
      const prompt = PLATFORM_BASE_PROMPT_V1.toLowerCase();
      expect(prompt).toContain("called by mistake or reached the wrong number");
      expect(prompt).toContain("that one short introduction is a courtesy, not a pitch");
    });

    it("instructs consultative persuasion grounded only in real facts — no fabricated discounts, pricing, availability, reviews, or urgency", () => {
      const prompt = PLATFORM_BASE_PROMPT_V1.toLowerCase();
      expect(prompt).toContain(
        "never invent a discount, a price, availability, a review, or urgency",
      );
      expect(prompt).toContain("only two slots left");
      expect(prompt).toContain("never use fear or guilt to push someone toward a decision");
    });

    it("instructs never pressuring a caller who objects — acknowledge and remove pressure explicitly", () => {
      const prompt = PLATFORM_BASE_PROMPT_V1.toLowerCase();
      expect(prompt).toContain("i don't want a salesperson");
      expect(prompt).toContain("never pressure them");
      expect(prompt).toContain("totally fine, you don't have to decide anything right now");
    });
  });

  /**
   * v25, found with scripts/measure-mood-conversion.ts across ten
   * real-model mood scenarios: tone adaptation per mood was already
   * strong, but in 5 of 10 the caller explicitly said "go ahead, submit
   * it" (twice, in two of those five) and the model kept re-asking the
   * same unanswered diagnostic follow-up instead of calling
   * createCustomer/createLead with what it already had — the same
   * self-imposed-blocking-field pattern v15/v19 already fixed for
   * contact-info fields, recurring one field class over (the problem
   * description itself), because neither the existing close-signal rule
   * nor its examples had ever been shown to cover that case explicitly.
   */
  describe("v25 — explicit caller consent to close overrides an unanswered diagnostic follow-up (real-model mood-conversion audit)", () => {
    it("names an explicit action phrase as an even stronger close signal than a soft one, effective the first time it's said", () => {
      const prompt = PLATFORM_BASE_PROMPT_V1.toLowerCase();
      expect(prompt).toContain("an even stronger signal than a soft close");
      expect(prompt).toContain("already unambiguous the first time");
    });

    it("extends the no-self-imposed-blocking-field rule explicitly to the model's OWN diagnostic questions about the problem, not just contact-info fields", () => {
      const prompt = PLATFORM_BASE_PROMPT_V1.toLowerCase();
      expect(prompt).toContain("this applies just as much to your own follow-up questions");
      expect(prompt).toContain(
        "a diagnostic detail you'd like to know is never a gate on createcustomer/createlead",
      );
    });

    it("instructs that an approximate, honest problem_summary is complete on its own — full diagnosis is the technician's job, not a phone-call prerequisite", () => {
      const prompt = PLATFORM_BASE_PROMPT_V1.toLowerCase();
      expect(prompt).toContain("problem_summary doesn't need every detail nailed down");
      expect(prompt).toContain("a technician assesses the specifics in person");
    });

    it("instructs calling createCustomer/createLead the same turn a caller repeats their consent instead of answering one more clarifying question", () => {
      const prompt = PLATFORM_BASE_PROMPT_V1.toLowerCase();
      expect(prompt).toContain("that's the caller telling you twice");
      expect(prompt).toContain("don't ask a third time");
    });
  });

  /**
   * v27, real-call finding: a caller opening with "how are you" got
   * answered but never reciprocated ("hi grace how you" -> "Hey, doing
   * well! What's going on?") — a one-sided exchange that reads as an
   * interview, not a conversation.
   */
  describe("v27 — reciprocate a caller's opening social nicety instead of only answering it", () => {
    it("instructs answering an opening 'how are you' briefly and warmly, then asking it back before moving into the call reason", () => {
      const prompt = PLATFORM_BASE_PROMPT_V1.toLowerCase();
      expect(prompt).toContain("ask it back before moving into why they");
      expect(prompt).toContain("one-sided");
    });
  });

  /**
   * v28, from a real prospect's test call that went badly (the SAME
   * call this session's fragment-detector and repeating-silence-check-in
   * fixes also came from). Two real, live-observed failures:
   *
   * (1) v27's own ask-it-back rule backfired on its first live outing —
   * the caller said "hi grace" and the ENTIRE spoken response was the
   * single clipped word "How" (the start of "How are you?"), because the
   * question led the response and got talked over immediately.
   * (2) the same caller opened with "Hi Grace, my name is Larry, I have
   * a water heater problem" — name and problem volunteered together —
   * and still got asked for both separately.
   */
  describe("v28 — real-call fixes: the reciprocated question must not LEAD a response, and multi-field openers must be absorbed whole", () => {
    it("instructs the greeting/offer-to-help to come before the reciprocated question, never a bare question as the opening words", () => {
      const prompt = PLATFORM_BASE_PROMPT_V1.toLowerCase();
      expect(prompt).toContain("never open a response with the bare question itself");
      expect(prompt).toContain('clipped to a bare "how"');
      expect(prompt).toContain("everything essential goes first");
    });

    it("instructs absorbing everything a caller volunteers in one breath (e.g. name + problem together) and never re-asking for it", () => {
      const prompt = PLATFORM_BASE_PROMPT_V1.toLowerCase();
      expect(prompt).toContain("take all of it in one pass");
      expect(prompt).toContain("never ask for something they already said");
    });
  });
});
