import { isRepeatRequest, isStalledReply, trailsOff } from "./stalled-reply";

describe("isStalledReply", () => {
  it.each([
    "Perfect, I have 42 Maple Street, 3 0 3 0 1.",
    "Got it, Prateek.",
    "Okay, I've noted that.",
    "Thanks, that's saved.",
  ])("treats %p as a stall", (reply) => {
    expect(isStalledReply(reply)).toBe(true);
  });

  it.each([
    "Is that right?",
    "Got it. What's the address?",
    "Sure, go ahead.",
    "Take your time.",
    "Can you spell that for me.",
    "Please confirm the ZIP code.",
    "You're all set. Have a great day!",
    "Thanks for calling, bye!",
    "Sorry, we only cover King and Pierce counties. Good luck with it.",
    "",
    "   ",
  ])("does not treat %p as a stall", (reply) => {
    expect(isStalledReply(reply)).toBe(false);
  });
});

describe("trailsOff", () => {
  it.each([
    "hi, so let me check on",
    "my address is",
    "actually my",
    "the zip code is",
    "it's under the",
  ])("flags %p", (text) => {
    expect(trailsOff(text)).toBe(true);
  });
  it.each([
    "my sink is leaking",
    "hold on, let me find the zip code",
    "yes",
    // 2026-10-14: "from" is a complete answer here ("where is it leaking
    // from?" / "I don't know where from."), not an unfinished sentence.
    // A real QA run showed the model silently stopped at "Mm-hm." for
    // this exact text, 3/3 caller turns in without ever asking for a name,
    // because a false trailsOff now suppresses every other note on the turn.
    "I don't know where from.",
    "that's who it's from",
  ])("does not flag %p", (text) => {
    expect(trailsOff(text)).toBe(false);
  });
});

/**
 * 2026-10-22 tester call: the address readback came out fast and garbled,
 * "and when asked what, it moved on to next question like what's the best
 * phone number and all." A caller who did not hear needs the same words
 * again, not the next question.
 */
describe("isRepeatRequest", () => {
  it.each([
    "what",
    "what?",
    "huh",
    "sorry",
    "pardon",
    "come again",
    "say that again",
    "sorry, say that again",
    "I didn't catch that",
    "could you repeat that please",
    "what did you say",
    "sorry you broke up there for a second",
    "one more time",
  ])("hears the request to repeat in %p", (said) => {
    expect(isRepeatRequest(said)).toBe(true);
  });

  it.each([
    "what time do you open",
    "what do you need from me",
    "what's the cost going to be",
    "yes that's right",
    "my kitchen sink is leaking",
    "sorry about the noise, my dog is barking",
    "",
  ])("does not treat %p as a request to repeat", (said) => {
    expect(isRepeatRequest(said)).toBe(false);
  });
});
