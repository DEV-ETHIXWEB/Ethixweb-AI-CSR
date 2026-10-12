import { isStalledReply } from "./stalled-reply";

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
    "",
    "   ",
  ])("does not treat %p as a stall", (reply) => {
    expect(isStalledReply(reply)).toBe(false);
  });
});
