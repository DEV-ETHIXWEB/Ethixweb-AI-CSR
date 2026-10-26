import {
  asksGracesName,
  declinedTheirName,
  offersAddress,
  upsetAndWantsAPerson,
} from "./caller-steering";

const askedName = { speaker: "agent", text: "I understand. Can you please share your name?" };

// 2026-10-26, Yash's test calls.
describe("declinedTheirName", () => {
  it.each([
    "i don't want to share my screen solution can help me or not not to disturb me on that",
    "i don't want to give my name",
    "i'd rather not say",
    "why do you need my name",
    "no name please just help me",
  ])("%p, answering the name question", (said) => {
    expect(declinedTheirName([askedName, { speaker: "caller", text: said }])).toBe(true);
  });

  it("not when the name question was not the one asked", () => {
    expect(
      declinedTheirName([
        { speaker: "agent", text: "Do you want the technician to call first?" },
        { speaker: "caller", text: "i don't want to give them a call" },
      ]),
    ).toBe(false);
  });

  it("not when they gave it", () => {
    expect(declinedTheirName([askedName, { speaker: "caller", text: "it's yash patel" }])).toBe(
      false,
    );
  });
});

describe("asksGracesName", () => {
  it.each([
    "my address is thirty seven what was your name again",
    "who am i speaking with",
    "sorry what's your name",
  ])("%p", (said) => {
    expect(asksGracesName(said)).toBe(true);
  });
  it.each(["what was my name again", "my name is walter", "can you repeat my name"])(
    "not %p",
    (said) => {
      expect(asksGracesName(said)).toBe(false);
    },
  );
});

describe("offersAddress", () => {
  it.each([
    "my address is my address is thirty seven",
    "i live at forty two pine",
    "the address is 1215 north 92nd",
  ])("%p", (said) => {
    expect(offersAddress(said)).toBe(true);
  });
  it.each(["what's the address of your office", "i already gave you my address"])(
    "not %p",
    (said) => {
      expect(offersAddress(said)).toBe(false);
    },
  );
});

describe("upsetAndWantsAPerson", () => {
  it.each([
    "you guys charged me four hundred bucks and the leak is back again, this is ridiculous. i want my money back and i want to talk to the owner right now",
    "nobody showed up yesterday, let me speak to a manager",
  ])("%p", (said) => {
    expect(upsetAndWantsAPerson(said)).toBe(true);
  });
  it.each(["can i talk to a person please", "this is ridiculous, my sink is leaking again"])(
    "not %p",
    (said) => {
      expect(upsetAndWantsAPerson(said)).toBe(false);
    },
  );
});
