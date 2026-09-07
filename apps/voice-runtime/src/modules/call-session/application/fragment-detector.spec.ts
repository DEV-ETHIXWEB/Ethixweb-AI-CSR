import { looksLikeIncompleteFragment } from "./fragment-detector";

describe("looksLikeIncompleteFragment", () => {
  it.each([
    ["can you"],
    ["Can you"],
    ["do you"],
    ["will you"],
    ["what time"],
    ["oh sorry like"],
    ["i was fixing my"],
    ["it's my"],
    ["going to the"],
    ["talking about the"],
    ["um"],
    ["so"],
  ])("REAL-CALL / MISSION EXAMPLE: %p is flagged as a likely-incomplete fragment", (transcript) => {
    expect(looksLikeIncompleteFragment(transcript)).toBe(true);
  });

  it.each([
    ["yes"],
    ["no"],
    ["yeah"],
    ["okay"],
    ["Akash"],
    ["akash kumar"],
    ["that's right"],
    ["not right now"],
    ["water heater"],
    ["nine three one one"],
    ["bye"],
    ["hello"],
  ])("MISSION EXAMPLE: %p is a genuinely complete short utterance, NOT flagged", (transcript) => {
    expect(looksLikeIncompleteFragment(transcript)).toBe(false);
  });

  it("a long, complete-sounding utterance is never flagged regardless of its own words — word-count gate always wins", () => {
    expect(looksLikeIncompleteFragment("you're still interrupting me when i'm talking")).toBe(
      false,
    );
    expect(
      looksLikeIncompleteFragment("can you please just let me finish what I was saying to you"),
    ).toBe(false);
  });

  it("empty or whitespace-only transcript is never flagged", () => {
    expect(looksLikeIncompleteFragment("")).toBe(false);
    expect(looksLikeIncompleteFragment("   ")).toBe(false);
  });

  it("is case-insensitive and punctuation-tolerant on both the opening and trailing word", () => {
    expect(looksLikeIncompleteFragment("CAN you")).toBe(true);
    expect(looksLikeIncompleteFragment("oh sorry, like")).toBe(true);
    expect(looksLikeIncompleteFragment("Oh sorry LIKE.")).toBe(true);
  });
});
