import {
  doubtsItWillHappen,
  MISSED_CALLBACK_DOUBT_NOTE,
  missedCallbackNote,
  reportsMissedCallback,
} from "./missed-callback";

/**
 * 2026-11-05. Real-model QA (round5-05) showed the apology arriving only
 * sometimes: on some runs Grace went straight into taking details as though
 * nothing had happened. This is the one moment on the line where the caller
 * has already been let down before Grace speaks, and the call most likely
 * to become a bad review, so it is not left to sampling variance.
 */
describe("a caller reporting a call that never came", () => {
  it.each([
    "I called two days ago and was told someone would call me back within a day. Nobody did, so I'm following up myself.",
    "nobody called me back",
    "no one ever got back to me",
    "I never heard back from anyone",
    "you didn't call me back like you said",
    "still haven't heard back about my quote",
    "this is the second time I'm calling about this",
    // The elliptical form, which is how people actually say it. The second
    // sentence has no verb of its own and only means this next to the
    // mention of a call, so both halves are required.
    "I was told someone would call me back. Nobody did.",
    "They said they would call me back and no one did",
  ])("is recognised in %p", (said) => {
    expect(reportsMissedCallback(said)).toBe(true);
  });

  it.each([
    // A request or a question about a FUTURE call is ordinary, and
    // apologising for something that has not happened would be strange.
    "can you call me back this afternoon?",
    "will someone call me back today?",
    "please call me back on this number",
    "what's the best number to call me back on",
    "my sink is leaking",
    "yes that's the right number",
    // "nobody did" with no call mentioned is about something else.
    "I asked them to check the valve and nobody did",
  ])("is not read into %p", (said) => {
    expect(reportsMissedCallback(said)).toBe(false);
  });
});

describe("what Grace is told to say about it", () => {
  const note = missedCallbackNote("call-aaa");

  it("puts the apology first, before any question", () => {
    expect(note).toContain("FIRST sentence");
    expect(note).toMatch(/I'm sorry/);
  });

  it("stops her apologising twice, explaining, or blaming anyone", () => {
    expect(note).toContain("say it once, not twice");
    expect(note).toContain("Do not explain why it happened");
    expect(note).toContain("do not blame");
  });

  it("forbids the promise she cannot keep", () => {
    // A second broken promise is worse than the first, and the scenario's
    // own check rejects "I promise" and "guaranteed".
    expect(note).toContain("Never promise or guarantee");
    expect(note).toContain("never give a time");
  });

  it("gives the caller something true and concrete instead", () => {
    expect(note).toContain("second call");
  });

  it("varies the opener between calls but never within one", () => {
    const openerOf = (id: string) => missedCallbackNote(id).match(/"([^"]+)"/)?.[1];
    expect(openerOf("call-aaa")).toBe(openerOf("call-aaa"));
    const seen = new Set(
      ["a", "b", "c", "d", "e", "f", "g", "h"].map((id) => openerOf(`call-${id}`)),
    );
    // The same sentence on every such call is what makes Grace a recording,
    // and these are the calls a caller repeats to other people.
    expect(seen.size).toBeGreaterThan(1);
  });
});

/**
 * Seen on the real model: the apology landed, the caller immediately asked
 * "How do I know this time it's actually going to happen? I don't want to
 * have to call a third time", and Grace replied "Can you tell me what's
 * going on with the water heater?" She changed the subject on the one
 * thing they rang back about.
 */
describe("the doubt that the apology always earns", () => {
  it.each([
    "How do I know this time it's actually going to happen?",
    "I don't want to have to call a third time",
    "what's different this time",
    "how can I be sure someone actually rings",
    "what if nobody calls again",
  ])("is recognised in %p", (said) => {
    expect(doubtsItWillHappen(said)).toBe(true);
  });

  it.each(["my water heater is leaking", "yes that's right", "can you call me back today?"])(
    "is not read into %p",
    (said) => {
      expect(doubtsItWillHappen(said)).toBe(false);
    },
  );

  it("answers the question instead of changing the subject", () => {
    expect(MISSED_CALLBACK_DOUBT_NOTE).toContain("ANSWER THIS");
    // The failure seen on the real model was a NEW question ("Is this for
    // your home?") on the turn the caller asked how they could trust it.
    expect(MISSED_CALLBACK_DOUBT_NOTE).toContain("Ask no question at all this turn");
  });

  it("offers the one concrete thing that is actually true", () => {
    // Grace cannot make anyone call. What reassures here is not warmth, it
    // is a checkable difference, so she says what really happens.
    expect(MISSED_CALLBACK_DOUBT_NOTE).toContain("second call");
    expect(MISSED_CALLBACK_DOUBT_NOTE).toContain("cannot promise a time");
  });

  it("does not apologise a second time", () => {
    // By this turn they have had the apology; repeating it reads as stalling.
    expect(MISSED_CALLBACK_DOUBT_NOTE).toContain("Do not apologise again");
  });
});
