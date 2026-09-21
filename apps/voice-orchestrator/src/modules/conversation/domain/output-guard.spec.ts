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
