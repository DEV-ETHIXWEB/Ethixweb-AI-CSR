import { isStalledReply, trailsOff } from "./stalled-reply";

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
  it.each(["my sink is leaking", "hold on, let me find the zip code", "yes"])(
    "does not flag %p",
    (text) => {
      expect(trailsOff(text)).toBe(false);
    },
  );
});
