import {
  OutputGuard,
  SAFE_CAUSE_LINE,
  SAFE_CHANGE_LINE,
  SAFE_PREFERENCE_LINE,
  SAFE_TIMING_LINE,
} from "./output-guard";

const apply = (text: string): string => new OutputGuard().apply(text);

describe("OutputGuard, on the exact lines from the clients' real test calls", () => {
  it("drops reasoning that leaked into speech (call f80d84dc)", () => {
    expect(
      apply(
        'George already said goodbye and ended the call ("no that\'s all thanks"). Per the instructions, a caller who signs off gets let go with a short closing line.',
      ),
    ).toBe("");
  });

  it.each([
    [
      "Perfect. Your info's been sent over to the team, they'll call you back to lock in a time today.",
    ],
    ["Got you down for today if we can make it work."],
    ["Perfect. The team will call tomorrow to lock in the time for the kitchen sink."],
    ["The team will reach out to lock in the time for today."],
  ])("replaces a timing promise: %s", (line) => {
    const result = apply(line);
    expect(result).not.toMatch(/today|tomorrow/i);
    expect(result).toContain(SAFE_TIMING_LINE);
  });

  it("turns 'tomorrow after two works' into a noted preference, not an agreement", () => {
    expect(apply("Okay, tomorrow after two works. I'll note that.")).toContain(
      SAFE_PREFERENCE_LINE,
    );
  });

  it("leaves honest timing language alone", () => {
    for (const line of [
      "I can't lock in a specific time from here, but I'll note that you'd prefer tomorrow morning.",
      "We're open 24/7, so weekends are no problem.",
      "The team will confirm those details when they call you back.",
      "Do you need someone out today, or is it okay to wait?",
      "Same-day service is sometimes available when booked before 2pm.",
    ]) {
      expect(apply(line)).toBe(line);
    }
  });

  it("does not say the same replacement twice in one turn", () => {
    const guard = new OutputGuard();
    const first = guard.apply("They'll call you today to confirm.");
    const second = guard.apply("The team will be there today.");
    expect(first).toContain(SAFE_TIMING_LINE);
    expect(second).toBe("");
  });

  it("stops Grace claiming an appointment was cancelled or rescheduled (call f80d84dc)", () => {
    expect(apply("Let me get that cancelled for you.")).toBe(SAFE_CHANGE_LINE);
    expect(apply("I've rescheduled your appointment for Friday.")).toBe(SAFE_CHANGE_LINE);
    expect(apply("I can't cancel appointments from here.")).toBe(
      "I can't cancel appointments from here.",
    );
  });

  it("reads addresses and phone numbers slowly", () => {
    expect(apply("Just to confirm, 1200 Pine Street, Seattle?")).toMatch(/^\[slowly\] /);
    expect(apply("Let me make sure I have that right: 2-0-6-5-5-5-0-1-4-7?")).toMatch(
      /^\[slowly\] /,
    );
    expect(apply("Your zip is 98101, right?")).toMatch(/^\[slowly\] /);
  });

  it("hyphenates the house number with zeros as oh so TTS reads each digit cleanly", () => {
    expect(apply("So that's 14101 Pine Street?")).toBe(
      "[slowly] So that's 1-4-1-oh-1 Pine Street?",
    );
    expect(apply("Just to confirm, 1200 Pine Street, Seattle?")).toBe(
      "[slowly] Just to confirm, 1-2-oh-oh Pine Street, Seattle?",
    );
    expect(apply("Got it, 6204 Main Street.")).toBe("[slowly] Got it, 6-2-oh-4 Main Street.");
  });

  it("does not slow down ordinary sentences, and never doubles the cue", () => {
    expect(apply("Got it, what's going on with the sink?")).toBe(
      "Got it, what's going on with the sink?",
    );
    expect(apply("[slowly] 1200 Pine Street?")).toBe("[slowly] 1-2-oh-oh Pine Street?");
  });

  it("passes emotional cues and empty input through untouched", () => {
    expect(apply("[sincere] I'm sorry you're dealing with that.")).toBe(
      "[sincere] I'm sorry you're dealing with that.",
    );
    expect(apply("")).toBe("");
  });

  it("replaces a guessed cause or link between problems with a technician-will-check line", () => {
    for (const line of [
      "Got it, so we've got the clogged sink and a gurgling dishwasher, those could be connected.",
      "The gurgling usually ties to the same drain line.",
      "Water heater leaks are usually caused by the tank rusting through.",
    ]) {
      expect(apply(line)).toContain(SAFE_CAUSE_LINE);
    }
  });

  it("leaves questions and honest inspect-to-confirm wording alone", () => {
    for (const line of [
      "That can come from a few different things, so a technician would need to inspect it to confirm.",
      "Is the dishwasher connected to the same drain?",
      "A technician can check both while they're there.",
    ]) {
      expect(apply(line)).toBe(line);
    }
  });
});

describe("OutputGuard repeated statements (vendor call Oct 7: 'Pricing depends on the job' three times)", () => {
  const earlier = [
    "Pricing depends on the job and will be discussed before any work begins. What's the address?",
  ];

  it("drops a statement already made in a recent reply", () => {
    const guard = new OutputGuard(earlier);
    const out = guard.apply(
      "Pricing depends on the job and will be discussed before any work begins. ",
    );
    expect(out).toBe("");
    expect(guard.actions).toContain("repeated_statement");
  });

  it("keeps the new part of a reply that also repeats an old statement", () => {
    const guard = new OutputGuard(earlier);
    const out = guard.apply(
      "Pricing depends on the job and will be discussed before any work begins. The technician gives you the exact price on site before starting.",
    );
    expect(out).toContain("technician gives you the exact price");
    expect(out).not.toContain("Pricing depends");
  });

  // 2026-10-26, Prateek's live call: asked for the address, he gave his last
  // name instead, and Grace's reply "Thanks for that, Trevor Michael. What is
  // the service address, including the street and ZIP code?" lost its
  // question to this guard. She went silent until he said "what". The
  // question asked last turn, unanswered, is asked again; only a duplicate
  // within the same reply is dropped. (This replaces the 2026-10-14 rule that
  // dropped it, from vendor-02: a re-asked question is better than silence.)
  it("re-asks the question from last turn when the caller answered something else", () => {
    const guard = new OutputGuard([
      "Got it, Trevor, T-R-E-V-O-R. What is the service address, including the street and ZIP code?",
    ]);
    expect(
      guard.apply(
        "Thanks for that, Trevor Michael. What is the service address, including the street and ZIP code?",
      ),
    ).toContain("What is the service address");
  });

  it("still drops the same question twice in one reply", () => {
    const question = "Is the number you're calling from the best one to reach you?";
    const pass1 = `Got it. ${question}`;
    const guard = new OutputGuard([pass1], true, pass1);
    expect(guard.apply(question)).toBe("");
    expect(guard.actions).toContain("repeated_statement");
  });

  it("still allows re-asking a question after a longer gap, not just the immediately preceding turn — 'come back to it later' is legitimate", () => {
    // Only the single most-recent agent turn is checked for a question
    // repeat; a genuinely still-unanswered field several turns back must
    // still be askable again.
    const guard = new OutputGuard([
      "What's the zip code for that address?",
      "Got it, I've noted that.",
    ]);
    expect(guard.apply("What's the zip code for that address?")).toContain("zip code");
  });

  it("never drops short sentences", () => {
    const guard = new OutputGuard(["Okay, got it."]);
    expect(guard.apply("Okay, got it.")).toBe("Okay, got it.");
  });

  it("does nothing without earlier replies", () => {
    const guard = new OutputGuard();
    expect(
      guard.apply("Pricing depends on the job and will be discussed before any work begins."),
    ).toContain("Pricing depends");
  });
});

describe("OutputGuard v53 meta phrases (QA 2026-10-13)", () => {
  it("drops talk about turns, which only makes sense to the model", () => {
    const guard = new OutputGuard();
    const out = guard.apply(
      "Actually, you asked me only one thing this turn, so let me stick to it. What's the best number to reach you?",
    );
    expect(out).not.toContain("this turn");
    expect(out).toContain("best number");
  });

  it("drops narration of how the call was classified", () => {
    const guard = new OutputGuard();
    expect(guard.apply("I'm flagging this as an emergency right now. ")).toBe("");
  });
});

describe("OutputGuard call-centre phrasing (vendor CSR style, QA 2026-10-13)", () => {
  it("rewrites 'May I have your name?' into plain speech", () => {
    expect(new OutputGuard().apply("May I have your name?")).toBe("Can I get your name?");
    expect(new OutputGuard().apply("Thanks. And may I have the ZIP?")).toBe(
      "Thanks. And can I get the ZIP?",
    );
  });
});

describe("OutputGuard tool narration (QA 2026-10-13)", () => {
  it.each([
    "Water under the cabinet is an urgent one, so I'm checking that now.",
    "Retrying the lead with the saved customer record.",
    "Let me check that for you.",
    "Sewage coming up in the shower is serious, so I'm flagging this now.",
    "Saving your request now.",
    "Let me check how urgent this is.",
  ])("drops %p", (sentence) => {
    expect(new OutputGuard().apply(sentence)).toBe("");
  });

  it("keeps an ordinary question that happens to use 'check'", () => {
    expect(new OutputGuard().apply("Can you check whether the valve is off?")).toContain("valve");
  });
});

describe("OutputGuard reasoning leaks with thinking off (QA 2026-10-13, Haiku 5.5)", () => {
  it("drops reasoning written as the reply and keeps the real reply", () => {
    const out = new OutputGuard().apply(
      "Speak whatever language the caller speaks. Caller is speaking Spanish. Need to call escalateEmergency since they describe a problem, and ask whether it's active. Ay, qué mal. ¿La fuga está pasando ahorita?",
    );
    expect(out).not.toMatch(/caller|escalateEmergency|Need to/i);
    expect(out).toContain("¿La fuga está pasando ahorita?");
  });

  it("drops a sentence said twice in a row, however short", () => {
    expect(new OutputGuard().apply("Good luck with it. Good luck with it.")).toBe(
      "Good luck with it.",
    );
  });
});

describe("OutputGuard length and wording tidy-ups (QA 2026-10-13)", () => {
  it("drops a bare acknowledgment in the middle of a reply", () => {
    expect(
      new OutputGuard().apply("Sewage coming up is serious. Got it. Can I get your name?"),
    ).toBe("Sewage coming up is serious. Can I get your name?");
  });

  it("keeps an acknowledgment that opens the turn", () => {
    expect(new OutputGuard().apply("Got it. What's the address?")).toBe(
      "Got it. What's the address?",
    );
  });

  it("drops an opening acknowledgment when an earlier pass of the same turn already spoke", () => {
    expect(new OutputGuard([], true).apply("Got it. What's the address?")).toBe(
      "What's the address?",
    );
  });

  it("never says 'today' in its own statements", () => {
    expect(new OutputGuard().apply("I can't promise a call today, but I'll note it.")).not.toMatch(
      /today/i,
    );
  });
});

describe("OutputGuard 2026-10-15: [slowly] consolidation", () => {
  it("strips model-added [slowly] on multiple sentences and applies one at the front", () => {
    const out = new OutputGuard().apply(
      "[slowly] Got it, ZIP 11018. [slowly] Which is it? [slowly] Let me check.",
    );
    const slowlyCount = (out.match(/\[slowly\]/gi) ?? []).length;
    expect(slowlyCount).toBe(1);
    expect(out).toMatch(/^\[slowly\]/);
  });

  it("does not add [slowly] when no readback is present", () => {
    expect(new OutputGuard().apply("Got it, what else?")).not.toContain("[slowly]");
  });
});

describe("OutputGuard 2026-10-15: word limit", () => {
  it("drops sentences past the soft word limit", () => {
    const long =
      "Got it, no hot water. Is there any water leaking or flooding anywhere right now? Thanks for telling me. Since you have no hot water, the team needs to see this. What is the service address?";
    const out = new OutputGuard().apply(long);
    const wordCount = out.split(/\s+/).filter(Boolean).length;
    expect(wordCount).toBeLessThan(40);
  });

  it("always keeps the first sentence even if it is long", () => {
    const single =
      "Got it, the team will look at your water heater issue and the technician will give you a flat rate quote before any work begins.";
    const out = new OutputGuard().apply(single);
    expect(out).toContain("flat rate quote");
  });
});

describe("OutputGuard 2026-10-14 tester-call leaks", () => {
  it.each([
    "There's a mix-up in the notes: the first name was Romalia.",
    "I'll save the new name and the callback number, then create the complaint lead.",
    "The save was refused, but the address you confirmed is 7714 Northeast 131st Street.",
    "I couldn't update the request notes from here.",
    "The address on file is Kirkland.",
  ])("drops %p", (sentence) => {
    expect(new OutputGuard().apply(sentence)).toBe("");
  });

  it("keeps ordinary plumbing talk that shares a word", () => {
    expect(new OutputGuard().apply("Is the old pipe made of lead?")).toContain("lead");
  });

  it("never asks the same question twice in one turn", () => {
    const guard = new OutputGuard(
      [],
      true,
      "Is the water running right now, or is it a suspected leak?",
    );
    expect(guard.apply("Got it. Is the water running right now, or is it a suspected leak?")).toBe(
      "",
    );
  });
});

/**
 * 2026-10-22 tester call: "Called as a returning customer, also gave name in
 * starting, but still near the end of the call it changed the name completely
 * to something else." Several people share a phone number, so a stored name
 * is never safe to say, and being called by a stranger's name at the close
 * undoes the whole call.
 */
describe("a name the caller never gave is not spoken", () => {
  const guard = () => new OutputGuard([], false, "", "Akash");

  it("drops a trailing vocative that is the wrong name", () => {
    expect(guard().apply("You're all set, Robert.")).toBe("You're all set.");
  });

  it("drops a wrong name after a thanks or a goodbye", () => {
    expect(guard().apply("Thanks Robert, take care.")).toBe("Thanks, take care.");
  });

  it("keeps the name the caller actually gave", () => {
    expect(guard().apply("You're all set, Akash.")).toBe("You're all set, Akash.");
  });

  it("tolerates a one-letter difference, which is speech recognition, not a new person", () => {
    expect(guard().apply("Thanks Akash, bye.")).toBe("Thanks Akash, bye.");
    expect(new OutputGuard([], false, "", "Ana").apply("You're all set, Anna.")).toBe(
      "You're all set, Anna.",
    );
  });

  it("leaves a name used any other way alone", () => {
    expect(guard().apply("Is that Robert Street or Roberts Avenue?")).toBe(
      "Is that Robert Street or Roberts Avenue?",
    );
  });

  it("changes nothing when no name was ever given", () => {
    expect(new OutputGuard().apply("You're all set, Robert.")).toBe("You're all set, Robert.");
  });

  it("does not mistake an ordinary capitalised word for a name", () => {
    expect(guard().apply("Got it, I'll note that.")).toBe("Got it, I'll note that.");
  });

  it("reports the rewrite so it can be counted", () => {
    const g = guard();
    g.apply("You're all set, Robert.");
    expect(g.actions).toContain("wrong_name");
  });
});

/**
 * 2026-10-22 tester call: "It took the address and it repeated the address
 * very fastly and again in a garbling manner." A readback whose sentence does
 * not carry the street TYPE word lost both of its protections at once: the
 * [slowly] cue and the digit-by-digit hyphenation.
 */
describe("a readback is recognised from the house number the caller gave", () => {
  it("slows and spells out a readback with no street type in the sentence", () => {
    const guard = new OutputGuard([], false, "", null, "4512");
    expect(guard.apply("So that's 4512 Maple?")).toBe("[slowly] So that's 4-5-1-2 Maple?");
  });

  it("says a zero as 'oh', which speech synthesis otherwise garbles", () => {
    const guard = new OutputGuard([], false, "", null, "6204");
    expect(guard.apply("Got it, 6204.")).toContain("6-2-oh-4");
  });

  it("still catches a full street readback with no house number known", () => {
    expect(new OutputGuard().apply("So that's 1200 Pine Street?")).toBe(
      "[slowly] So that's 1-2-oh-oh Pine Street?",
    );
  });

  it("leaves an ordinary sentence alone", () => {
    const guard = new OutputGuard([], false, "", null, "4512");
    expect(guard.apply("What's going on with the sink?")).toBe("What's going on with the sink?");
  });
});

/**
 * 2026-10-22: the other half of "when asked what, it moved on". Telling the
 * model to say its last sentence again is useless if this guard then drops it
 * as a repeat -- that would turn a caller who could not hear into a caller
 * hearing silence.
 */
describe("a repeat the caller asked for", () => {
  const readback = "So that's 4-5-1-2 Maple Street, is that right?";

  it("is dropped when nobody asked, which is why the suppression exists", () => {
    const guard = new OutputGuard([readback], false, "", null, null, false);
    expect(guard.apply(readback).trim()).toBe("");
  });

  it("is spoken when the caller asked for it", () => {
    const guard = new OutputGuard([readback], false, "", null, "4512", true);
    expect(guard.apply(readback)).toContain("4-5-1-2 Maple Street");
  });
});

/**
 * 2026-10-22, second tester: "there are few instances where the csr still
 * guesses big names - i tried with mexican, caucasian and black names."
 * Asked for letters it does not have, the model supplies the nearest
 * familiar name's spelling. The backstop for when it does it anyway.
 */
describe("a spelling that is not the caller's own", () => {
  it("replaces a guessed spelling with the caller's letters", () => {
    const guard = new OutputGuard([], false, "", "Siobhan", null, false, ["siobhan"]);
    expect(guard.apply("Siobhan — S-H-A-V-O-N-N-E, is that right?")).toContain("S-I-O-B-H-A-N");
  });

  it("fixes each name in its own position", () => {
    const guard = new OutputGuard([], false, "", "Siobhan", null, false, ["siobhan", "okonkwo"]);
    const out = guard.apply("That's S-H-A-V-O-N-N-E, O-C-O-N-K-O. Right?");
    expect(out).toContain("S-I-O-B-H-A-N");
    expect(out).toContain("O-K-O-N-K-W-O");
  });

  it.each([
    ["Jose", "jose", "J-O-S-E"],
    ["Luz", "luz", "L-U-Z"],
    ["Kwame", "kwame", "K-W-A-M-E"],
  ])("works for %p regardless of length or origin", (_name, word, letters) => {
    const guard = new OutputGuard([], false, "", _name, null, false, [word]);
    expect(guard.apply("So that's J-O-S-E-P-H, right?")).toContain(letters);
  });

  it("leaves a correct spelling exactly as it was", () => {
    const guard = new OutputGuard([], false, "", "Siobhan", null, false, ["siobhan"]);
    expect(guard.apply("Siobhan — S-I-O-B-H-A-N, right?")).toBe("Siobhan — S-I-O-B-H-A-N, right?");
  });

  it("tolerates a one-letter difference rather than fighting over it", () => {
    const guard = new OutputGuard([], false, "", "Ana", null, false, ["anna"]);
    expect(guard.apply("That's A-N-A, right?")).toContain("A-N-A");
  });

  it("changes nothing when no name is known", () => {
    expect(new OutputGuard().apply("So that's S-H-A-V-O-N, right?")).toBe(
      "So that's S-H-A-V-O-N, right?",
    );
  });

  it("does not touch a hyphenated digit read-back", () => {
    const guard = new OutputGuard([], false, "", "Tom", "4512", false, ["tom"]);
    expect(guard.apply("So that's 4-5-1-2 Maple Street?")).toContain("4-5-1-2");
  });
});

/** 2026-10-23 client calls: the callback number read back a digit short, and with "+1". */
describe("the callback number is read back exactly", () => {
  const guard = () => new OutputGuard([], false, "", null, null, false, [], ["8722784999"]);

  it("restores a digit the model dropped", () => {
    const said = guard().apply(
      "Just to check, is this the best number to reach you, 8-7-2-2-7-8-4-9-9?",
    );
    expect(said).toContain("8-7-2-2-7-8-4-9-9-9?");
  });

  it("drops the +1 and reads it digit by digit", () => {
    const said = guard().apply(
      "Is the number you're calling from, +1-872-278-4999, the best one to reach you?",
    );
    expect(said).toContain("8-7-2-2-7-8-4-9-9-9");
    expect(said).not.toContain("+1");
  });

  it("leaves a different number alone when the caller gave it", () => {
    const said = new OutputGuard(
      [],
      false,
      "",
      null,
      null,
      false,
      [],
      ["8722784999", "2065550147"],
    ).apply("Got it, so the best number is 2-0-6-5-5-5-0-1-4-7.");
    expect(said).toContain("2-oh-6-5-5-5-oh-1-4-7");
  });

  /** 2026-10-23 live call: the prompt's example number was read out as "the number you called from". */
  it("replaces a callback number nobody on this call ever had, in digits or in words", () => {
    expect(
      guard().apply("Is the number you called from, 2-0-6-5-5-5-0-1-4-7, the best one?"),
    ).toContain("8-7-2-2-7-8-4-9-9-9");
    const said = guard().apply(
      "Thanks, Peter. Just to confirm, is the number you called from, two-zero-six-five-five-five-zero-one-four-seven, the best way to reach you?",
    );
    expect(said).toContain("8-7-2-2-7-8-4-9-9-9");
    expect(said).not.toContain("two-zero-six");
  });

  it("leaves house numbers and ZIP codes alone", () => {
    const said = guard().apply("That's 1-7-4-8 Northwest 60th Street, ZIP 9-8-1-0-7.");
    expect(said).toContain("1-7-4-8");
    expect(said).toContain("9-8-1-0-7");
  });
});

/** 2026-10-23 live call: Grace said "Wait patiently for them to complete their thought." */
describe("bracketed stage directions are never spoken", () => {
  it("drops a direction that spans two sentences", () => {
    const said = new OutputGuard().apply(
      "[The caller is mid-sentence. Wait patiently for them to complete their thought.]",
    );
    expect(said.trim()).toBe("");
  });

  it("drops a direction that spans two streamed segments", () => {
    const guard = new OutputGuard();
    const first = guard.apply("[The caller is still talking. ");
    const second = guard.apply("Wait patiently for them to complete their thought.] ");
    const third = guard.apply("Mm-hm.");
    expect(`${first}${second}`.trim()).toBe("");
    expect(third).toContain("Mm-hm.");
  });

  it("drops what comes before a stray closing bracket", () => {
    expect(
      new OutputGuard().apply(" Wait patiently for them to complete their thought.]").trim(),
    ).toBe("");
  });

  it("keeps delivery cues and the words around them", () => {
    const said = new OutputGuard().apply(
      "[softly] I'm sorry to hear that. What's going on with it?",
    );
    expect(said).toContain("[softly]");
    expect(said).toContain("I'm sorry to hear that.");
  });
});

/** 2026-10-23, real-model QA on gpt-4o-mini: two questions in one reply. */
describe("one question per reply", () => {
  it("keeps the first question and drops the second", () => {
    const said = new OutputGuard().apply(
      "Got it. What seems to be the problem today? Is it happening right now?",
    );
    expect(said).toContain("What seems to be the problem today?");
    expect(said).not.toContain("Is it happening right now?");
  });

  it("keeps an answer and its one question", () => {
    const said = new OutputGuard().apply("Yes, we do tankless conversions. Can I get your name?");
    expect(said).toContain("Yes, we do tankless conversions.");
    expect(said).toContain("Can I get your name?");
  });
});

describe("2026-10-26: Grace never promises someone is on the way", () => {
  it.each([
    "You're all set, and help is on the way.",
    "We've got your info and someone's on the way to you now.",
    "We're dispatching someone out to you right now.",
    "Most emergency calls in the Seattle area get there within 60 to 90 minutes.",
  ])("%p", (said) => {
    expect(apply(said)).toContain("The team will call you to confirm when someone can come out.");
    expect(apply(said)).not.toMatch(/on the way|dispatching|within 60/);
  });

  it.each([
    "I'm getting you connected to someone right now who can dispatch a tech to you.",
    "The team will call you shortly to confirm timing.",
    "A technician will come out and locate where the leak is coming from.",
  ])("leaves %p alone", (said) => {
    expect(apply(said)).toBe(said);
  });
});

describe("OutputGuard: whether the visit costs anything is not published (2026-10-26)", () => {
  // The client's test scripts, on the production model: "It's not a free
  // service", said to someone asking about a remodel estimate. The business
  // never published that either way.
  const apply = (text: string): string => new OutputGuard().apply(text);

  it.each([
    "The estimate visit includes a technician assessing the space and discussing your needs. It's not a free service, and that typically takes about an hour.",
    "The estimate visit is typically done for free, and the technician will assess your needs.",
    "We offer free estimates for remodels.",
    "There's a small fee for the technician to come out.",
    "The estimate visit is typically a flat-rate charge, and the technician will assess your needs and provide a quote.",
  ])("%p", (said) => {
    expect(apply(said)).toContain("The team will confirm any charge for the visit when they call.");
    expect(apply(said)).not.toMatch(
      /not a free|for free|free estimates|small fee|flat-rate charge/,
    );
  });

  it.each([
    "The estimate visit involves a technician assessing the plumbing needs, and the visit cost will be confirmed when you book.",
    "The technician gives an upfront, flat-rate quote before any work starts.",
    "There are no surprise charges once a price is given.",
    "We have $100 off drain cleaning, which includes a free mainline sewer camera inspection.",
    "Is the estimate visit for the bathroom remodel?",
    "Got it, so you're just asking about whether there's a diagnostic fee before you decide to book.",
  ])("leaves %p alone", (said) => {
    expect(apply(said)).toBe(said);
  });
});

describe("OutputGuard: whether the technician calls ahead is not known (2026-10-26)", () => {
  // The client's test scripts, all three runs on the production model.
  const apply = (text: string): string => new OutputGuard().apply(text);

  it.each([
    "The technician typically calls before arriving to confirm everything.",
    "The technician usually calls ahead to confirm their arrival.",
    "Yes, the technician will call before arriving, so you'll know to unlock the gate.",
    "Yes, they usually call before arriving.",
  ])("%p", (said) => {
    expect(apply(said)).toContain("I'll note that you'd like a call before they arrive.");
    expect(apply(said)).not.toMatch(/usually|typically|will call before/);
  });

  it.each([
    "I'll note that you'd like the technician to call ahead.",
    "The team will call you to set up a time.",
    "I'll make sure the technician knows to call before arriving.",
    "Would you like the technician to call before arriving?",
  ])("leaves %p alone", (said) => {
    expect(apply(said)).toBe(said);
  });
});

describe("OutputGuard: what a price includes is not known (2026-10-26)", () => {
  // The client's test scripts, on the production model: "Does that price
  // include the toilet itself?" got a different made-up answer on each run.
  const apply = (text: string): string => new OutputGuard().apply(text);

  it.each([
    "The price typically covers the installation labor; the cost of the toilet itself is usually separate.",
    "The quote covers labor only; you'd need to purchase the toilet separately.",
    "The price includes the installation, but the cost of the toilet itself is typically separate.",
  ])("%p", (said) => {
    expect(apply(said)).toContain("The technician's quote will spell out exactly what's included.");
    expect(apply(said)).not.toMatch(/separate|labor only/);
  });

  it.each([
    "The technician gives an upfront, flat-rate price before any work starts.",
    "We have $100 off drain cleaning, which includes a free mainline sewer camera inspection.",
    "Does the price you were quoted include the parts?",
    "I'll note that you'd like to know whether the price includes the toilet.",
    "Those are separate problems, so the technician can look at both.",
  ])("leaves %p alone", (said) => {
    expect(apply(said)).toBe(said);
  });
});

// 2026-10-26, real-model QA (tester-08): the caller corrected his address,
// and the corrected read-back, nearly word for word the first one, was
// dropped as a repeat. All he heard was "Is that right?".
describe("OutputGuard: a corrected read-back is not a repeat", () => {
  it("keeps a read-back whose digits changed", () => {
    const guard = new OutputGuard([
      "Let me make sure I have it right: Marco, M-A-R-C-O, Reyes, R-E-Y-E-S, at 6-1-2-oh 148th drive northeast, ZIP 9-8-oh-5-2. Is that right?",
    ]);
    expect(
      guard.apply(
        "Let me make sure I have it right: Marco, M-A-R-C-O, Reyes, R-E-Y-E-S, at 1-9-1-2 9th avenue west, ZIP 9-8-1-1-9. Is that right?",
      ),
    ).toContain("1-9-1-2");
  });

  it("still drops the same read-back said again unasked", () => {
    const readback =
      "Let me make sure I have it right: Marco, M-A-R-C-O, at 1-9-1-2 9th avenue west, ZIP 9-8-1-1-9.";
    const guard = new OutputGuard([readback]);
    expect(guard.apply(readback).trim()).toBe("");
  });
});

// 2026-10-26, real-model QA (feedback-04), on the deployed version as well:
// "A leaking water heater can happen for a few reasons, like a faulty valve
// or corrosion." Naming possible causes is still diagnosing.
describe("OutputGuard: listing possible causes is diagnosing", () => {
  it.each([
    "A leaking water heater can be due to several reasons like a faulty valve or corrosion.",
    "A leaking water heater can happen for a few reasons, like a faulty valve or a crack.",
    "A water heater can leak for a few reasons, like a faulty valve or corrosion.",
    "A leaking water heater can happen for several reasons, like a failed pressure valve or a tank issue.",
    "That can happen for a few reasons, like age or a faulty valve.",
    "That can be caused by a few different issues.",
  ])("%p", (said) => {
    expect(new OutputGuard().apply(said)).toContain(
      "A technician will need to look at that to confirm.",
    );
  });

  it.each([
    "That can come from a few different things, so a technician will need to take a look.",
    "We handle valves, tanks and fittings.",
  ])("leaves %p alone", (said) => {
    expect(new OutputGuard().apply(said)).toBe(said);
  });
});
