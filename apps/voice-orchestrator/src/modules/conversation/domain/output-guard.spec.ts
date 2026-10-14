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

  it("does not slow down ordinary sentences, and never doubles the cue", () => {
    expect(apply("Got it, what's going on with the sink?")).toBe(
      "Got it, what's going on with the sink?",
    );
    expect(apply("[slowly] 1200 Pine Street?")).toBe("[slowly] 1200 Pine Street?");
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

  it("never drops a question, even a repeated one", () => {
    const guard = new OutputGuard(["What's the zip code for that address?"]);
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
