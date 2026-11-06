import { objectsToPayingTwice, PAYING_TWICE_NOTE } from "./paying-twice";

/**
 * 2026-11-06, final real-model sweep (round4-03). The caller said they'd
 * rather not pay again for the same problem, and Grace answered "That makes
 * total sense. Let me confirm the callback number..." Acknowledged, then
 * straight back to form-filling, which reads as being handled rather than
 * heard.
 */
describe("a caller objecting to paying twice", () => {
  it.each([
    "I'd really rather not pay again for the same problem if it's something that should've been fixed right the first time.",
    "I don't want to be charged twice for the same leak",
    "am I going to have to pay for this again",
    "it should have been fixed right the first time",
    "I already paid for that repair and it's the same issue",
  ])("is recognised in %p", (said) => {
    expect(objectsToPayingTwice(said)).toBe(true);
  });

  it.each([
    // An ordinary price worry about NEW work is not this.
    "I don't want to pay a fortune for a new water heater",
    "how much will it cost",
    "my sink is leaking again",
    "can someone come out today",
  ])("is not read into %p", (said) => {
    expect(objectsToPayingTwice(said)).toBe(false);
  });
});

describe("what Grace is told to do about it", () => {
  it("answers the grievance before anything else", () => {
    expect(PAYING_TWICE_NOTE).toContain("Answer THAT before anything else");
    expect(PAYING_TWICE_NOTE).toContain("Do NOT ask");
  });

  it("names the one true next step", () => {
    expect(PAYING_TWICE_NOTE).toContain("the team will look at what happened");
  });

  it("does not let her settle what only the manager decides", () => {
    expect(PAYING_TWICE_NOTE).toContain("Never say they will not be charged");
    expect(PAYING_TWICE_NOTE).toContain("only the manager");
  });
});
