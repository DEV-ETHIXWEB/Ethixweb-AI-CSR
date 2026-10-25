import { speakableNumbers } from "./speakable-numbers";

describe('speakableNumbers (2026-10-25: "you are basically mumbling these digits")', () => {
  it.each([
    [
      "Your address is 5-4-oh-7 South Hood Court, Seattle, ZIP 98118.",
      "Your address is 5, 4, 0, 7, South Hood Court, Seattle, ZIP 9, 8, 1, 1, 8.",
    ],
    [
      "[slowly] Got it, 5407 Southford Port, Seattle, 98118.",
      "[slowly] Got it, 5, 4, 0, 7, Southford Port, Seattle, 9, 8, 1, 1, 8.",
    ],
    [
      "Is the number you're calling from, plus 8-7-2-2-7-8-4-9-9-9, the best one?",
      "Is the number you're calling from, 8, 7, 2, 2, 7, 8, 4, 9, 9, 9, the best one?",
    ],
    ["Is 872-278-4999 the best number?", "Is 8, 7, 2, 2, 7, 8, 4, 9, 9, 9, the best number?"],
    ["ZIP 9-8-1-oh-3. Is that right?", "ZIP 9, 8, 1, 0, 3. Is that right?"],
    ["Is it 12015 56th Place South?", "Is it 1, 2, 0, 1, 5, 56th Place South?"],
    ["Let me confirm that: (206) 895-6963?", "Let me confirm that: 2, 0, 6, 8, 9, 5, 6, 9, 6, 3?"],
  ])("%p", (said, spoken) => {
    expect(speakableNumbers(said)).toBe(spoken);
  });

  it.each([
    "The visit is $150 and takes 2 hours.",
    "We are open 24/7.",
    "Someone can come at 3:30.",
    "That's 100% covered.",
    "Got it, thanks.",
  ])("leaves %p alone", (said) => {
    expect(speakableNumbers(said)).toBe(said);
  });
});
