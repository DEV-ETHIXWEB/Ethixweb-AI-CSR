import {
  assembleLayeredPrompt,
  PLATFORM_BASE_PROMPT_V1,
  PLATFORM_BASE_PROMPT_VERSION,
} from "./prompt-layers";

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
    expect(result).toContain("never book appointments");
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
});

/**
 * v53 is a rewrite (see prompt-layers.ts). Each test pins one behaviour and
 * names the real call it came from, so a later edit cannot quietly drop a
 * lesson. Wording checks are deliberately on short, distinctive phrases.
 */
describe("PLATFORM_BASE_PROMPT v53", () => {
  const prompt = PLATFORM_BASE_PROMPT_V1;
  const lower = prompt.toLowerCase();

  it("is versioned v55 and far shorter than the 11,000-word v52", () => {
    expect(PLATFORM_BASE_PROMPT_VERSION).toBe("v55");
    expect(prompt.split(/\s+/).length).toBeLessThan(3700);
  });

  describe("core boundaries", () => {
    it("never books, quotes a price, or promises a time", () => {
      expect(lower).toContain("never book appointments, never quote prices");
      expect(lower).toContain("never promise same day, today, a time window or an arrival time");
      expect(lower).toContain("never quote typical response times");
      expect(lower).toContain('never say "today" or "tonight" yourself');
    });

    it("never diagnoses and never gives repair walkthroughs", () => {
      expect(lower).toContain("never diagnose");
      expect(lower).toContain("never name a cause");
      expect(lower).toContain("never say two problems are linked");
      expect(lower).toContain("a technician will need to take a look");
      expect(lower).toContain("never walk a caller through a repair");
    });

    it("never confirms a technician by name", () => {
      expect(lower).toContain("never confirm or describe a technician by name");
    });

    it("never claims a save, transfer or booking it did not see happen", () => {
      expect(lower).toContain("only after createlead succeeds");
      expect(lower).toContain('never say "i\'ve got your information"');
      expect(lower).toContain("never claim something happened that you did not see happen");
    });

    it("stays honest when the lead system is unavailable", () => {
      expect(lower).toContain("never say anyone will call back");
    });
  });

  describe("listening (vendor calls Oct 2, Oct 5, Oct 8; our calls 2026-10-13)", () => {
    it("treats the call notes as true and never re-asks what they list", () => {
      expect(prompt).toContain("[Call notes...]");
      expect(lower).toContain("never ask again for anything in them");
    });

    it("checks the whole call before every question, including home or business and timing", () => {
      expect(lower).toContain("before every question, check the whole call");
      expect(lower).toContain("answers home or business");
      expect(lower).toContain("answers timing");
    });

    it("never restarts the intake", () => {
      expect(lower).toContain("never restart the intake");
    });

    it("waits when asked to hold and never ends a call over silence (vendor call Oct 8)", () => {
      expect(prompt).toContain('say only "Sure, no rush." and then wait');
      expect(lower).toContain("never end a call because a caller went quiet");
    });

    it("stays quiet on a mid-sentence pause", () => {
      expect(lower).toContain("they are still talking. say nothing");
      expect(lower).toContain("trail off unfinished");
    });

    it("answers a hello check-in right away", () => {
      expect(prompt).toContain('"Yes, I\'m here."');
    });

    it("asks to repeat instead of guessing", () => {
      expect(lower).toContain(
        "never guess, and never describe a problem in words they did not use",
      );
    });
  });

  describe("names (vendor calls Oct 4, 5, 7, 8)", () => {
    it("uses the caller's spelling exactly and never swaps in a familiar-sounding name", () => {
      expect(lower).toContain("the spelling is the name");
      expect(lower).toContain("never swap in a more familiar-sounding name");
    });

    it("says the name at most twice, and not at all when unsure", () => {
      expect(lower).toContain("at most twice in the whole call");
      expect(lower).toContain("a wrong name is worse than no name");
    });

    /**
     * v55 (2026-10-22, Akash): "instead of asking in between to recheck the
     * details, can he just confirm that details at the end of the call?"
     *
     * The 2026-10-14 finding this replaces was that a name's spelling was
     * never confirmed AT ALL unless the caller demanded it. It still always
     * is — once, at the end, with the number, which is a different place and
     * not a dropped rule. The test is rewritten rather than deleted so the
     * guarantee stays covered: a name is never left unconfirmed.
     */
    it("confirms every name's spelling exactly once, at the end, not mid-intake", () => {
      expect(lower).toContain("do not read its letters back when you first hear it");
      expect(lower).toContain(
        "confirmed once, later, in the same breath as the callback number, right before you save",
      );
      expect(lower).toContain("never ask for the same name's spelling twice");
      expect(lower).toContain("could you spell that for me?");
    });

    /**
     * The 2026-10-14 competing-rules problem ("my name is Dana Whitfield and
     * my disposal is jammed" in one breath made Grace skip the spell-back
     * 3/3 real-model attempts) is dissolved rather than re-ruled by v55:
     * with no mid-call spell-back to compete with the reply-shape rule,
     * there is nothing left to lose the race. The bundled case still gets an
     * explicit instruction so the model is not left to infer it.
     */
    it("takes a bundled name and problem together, confirming the name later", () => {
      expect(lower).toContain("when the name arrives bundled with other things in the same breath");
      expect(lower).toContain("the name is confirmed at the end, not here");
    });

    it("never takes a greeting name as the caller's, never invents one, never changes a confirmed one", () => {
      expect(prompt).toContain('A name in a greeting ("hi Grace"');
      expect(lower).toContain("never invent one");
      expect(lower).toContain("never change a name once the caller confirmed it");
    });
  });

  describe("intake (vendor calls Oct 4, Oct 7, Oct 8)", () => {
    it("always asks for the ZIP once, accepting the city if they do not know it", () => {
      expect(lower).toContain("your very next question asks for the zip");
      expect(lower).toContain("the city is enough");
    });

    it("reads the address back once, digits one by one, and only the corrected part after a correction", () => {
      expect(lower).toContain("read the whole address back once");
      expect(lower).toContain("say back only that corrected part");
      expect(lower).toContain("never read the whole address again");
      expect(lower).toContain("a yes or \"that's right\" is final");
      expect(lower).toContain("the house number and a numbered street ran together");
    });

    /**
     * v55: still always confirmed (vendor call Oct 8 never asked for one at
     * all), but together with the name at the end instead of in a turn of
     * its own — see the NAMES tests above.
     */
    it("confirms the callback number together with the name, at the end", () => {
      expect(lower).toContain(
        "the callback number, confirmed together with the name, once, right before you save",
      );
      expect(lower).toContain("in one short line and nothing else");
      expect(lower).toContain("this is the only place either is confirmed");
    });

    it("lets the caller explain the problem before asking for contact details", () => {
      expect(lower).toContain(
        "do not ask for contact details before they have said why they called",
      );
    });

    it("notes a timing preference without agreeing to a time", () => {
      expect(lower).toContain("note their preference; never agree to a time");
    });
  });

  describe("returning callers (our test calls 2026-10-13)", () => {
    it("confirms a complete record instead of assuming it", () => {
      expect(prompt).toContain('never ask "Am I speaking with..."');
      expect(lower).toContain("never say a stored name or address");
    });

    it("treats a record missing a name or address like a new caller", () => {
      expect(lower).toContain("treat every caller as new");
    });

    it("knows createCustomer updates an existing record", () => {
      expect(lower).toContain("createcustomer updates the existing record");
    });
  });

  describe("saving", () => {
    it("saves only with the confirmed name, street address and callback number, address included", () => {
      expect(lower).toContain(
        "call createcustomer once you have the confirmed name, the confirmed street address and the confirmed callback number",
      );
      expect(lower).toContain("pass the address in that call");
    });

    it("writes unanswered questions and access notes into the summary (vendor call Oct 5)", () => {
      expect(lower).toContain("every question they asked that you could not answer");
      expect(lower).toContain("third floor");
    });

    it("sets priority from escalateEmergency and marks failed transfers and complaints urgent", () => {
      expect(prompt).toContain('"emergency"');
      expect(prompt).toContain('"urgent"');
      expect(prompt).toContain('"estimate"');
      expect(lower).toContain(
        'could not be transferred, or who is complaining about a missed visit, is "urgent"',
      );
    });

    it("updates the lead when something comes up later", () => {
      expect(prompt).toContain("call updateLead");
    });
  });

  describe("questions (vendor calls Oct 5 and Oct 7)", () => {
    it("answers every direct question first and never skips one", () => {
      expect(lower).toContain("a caller's direct question always comes first");
      expect(lower).toContain("never skip a question");
    });

    it("mentions a fitting coupon when price or discounts come up", () => {
      expect(lower).toContain("a current coupon fits their job, mention it");
    });

    it("never repeats the same pricing sentence (said three times on Oct 7)", () => {
      expect(lower).toContain("if they ask again, do not repeat that sentence");
      expect(lower).toContain("never say the same sentence twice in a call");
    });

    it("passes unknown questions to the team instead of inventing an answer", () => {
      expect(lower).toContain("you will make sure the team knows they asked");
      expect(lower).toContain(
        "never invent a service, a price, a discount, availability or a time",
      );
    });

    it("does not change appointments itself", () => {
      expect(lower).toContain("you cannot see, book, change or cancel them");
    });
  });

  describe("people and AI (vendor calls Oct 10 and Oct 11: three ignored requests for a human)", () => {
    it("transfers on the first request, without questions first", () => {
      expect(lower).toContain("the first time a caller asks for a human");
      expect(prompt).toContain("call transferToHuman in that same reply");
      expect(lower).toContain("do not ask anything first");
    });

    it("handles a failed transfer once and honestly, without looping", () => {
      expect(lower).toContain("do not offer the transfer again");
      expect(lower).toContain('never repeat "i can\'t transfer the call."');
    });

    it("answers the AI question honestly in one breath", () => {
      expect(prompt).toContain("I'm Grace, the AI receptionist here");
      expect(lower).toContain("never claim to be human");
    });
  });

  describe("emergencies", () => {
    it("always calls escalateEmergency and follows its decision", () => {
      expect(prompt).toContain("call escalateEmergency, every time");
      expect(prompt).toContain('"forward_call" means "emergency"');
    });

    it("judges by the situation, not the caller's tone", () => {
      expect(lower).toContain("judge by what is happening, never by how calm they sound");
    });

    it("keeps safety advice to one sentence, with the gas rule", () => {
      expect(lower).toContain("one short safety sentence");
      expect(lower).toContain("leave the building now and call the gas company from outside");
    });

    it("never claims a forwarded call is connected", () => {
      expect(lower).toContain("never say they are connected");
    });
  });

  describe("special calls", () => {
    it("handles complaints with one apology and no re-asking", () => {
      expect(lower).toContain("complaint about a past visit or a no-show");
      expect(lower).toContain("do not make them repeat details");
    });

    it("declines sales and marketing calls without taking details (vendor call: Mapcard)", () => {
      expect(prompt).toContain('"Thanks, we\'re not interested. Have a good day."');
    });

    it("never turns away a caller who may be covered", () => {
      expect(lower).toContain("never turn them away");
      expect(lower).toContain("a zip inside the business's listed ranges is covered");
    });

    it("lets a caller go when they say goodbye", () => {
      expect(lower).toContain("say one short warm goodbye and nothing else");
    });
  });

  describe("voice", () => {
    it("keeps replies short with one question, always ending on something to answer", () => {
      expect(lower).toContain("hard limit: twenty-five words per reply");
      expect(lower).toContain("ask one question per reply");
      expect(lower).toContain("never stop on a bare acknowledgment and wait");
    });

    it("bans stock openers and narration", () => {
      expect(prompt).toContain('"Absolutely"');
      expect(lower).toContain("never narrate what you are doing");
      expect(lower).toContain("call the tool first, say nothing before it");
    });

    it("keeps the exact delivery-cue vocabulary the voice engine supports", () => {
      for (const cue of ["sincere", "reassuring", "concerned", "calm", "pause"]) {
        expect(lower).toContain(cue);
      }
      expect(lower).toContain("never as a whole reply on its own");
    });

    it("speaks the caller's language", () => {
      expect(lower).toContain("speak whatever language the caller speaks");
    });

    it("never mentions tool failures to the caller", () => {
      expect(lower).toContain(
        "if a tool fails or rejects your input, never mention it to the caller",
      );
    });
  });
});
