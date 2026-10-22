import { reducePhoneticSpelling, spelledWordsIn } from "./spelled-letters";

/**
 * 2026-10-22 tester call: "Tried giving a tough name to it like Sibohan
 * Okonkwo, also spelled it word by word, still it was not able to capture."
 */
describe("spelledWordsIn", () => {
  it("still reads a plain letter-by-letter spelling", () => {
    expect(spelledWordsIn("it's s i o b h a n")).toEqual(["siobhan"]);
  });

  it("reads the 'S for Sam' convention, which used to yield nothing at all", () => {
    expect(
      spelledWordsIn(
        "s for sam, i for india, o for oscar, b for boy, h for harry, a for apple, n for nancy",
      ),
    ).toEqual(["siobhan"]);
  });

  it("reads 'as in' and 'like' the same way", () => {
    expect(spelledWordsIn("o as in oscar, k like kite, o as in oscar")).toEqual(["oko"]);
  });

  it("reads letter names once Grace has asked for a spelling", () => {
    expect(spelledWordsIn("ess eye oh bee aitch ay en", true)).toEqual(["siobhan"]);
  });

  it("leaves letter names alone when nobody asked for a spelling", () => {
    // "oh, are you able to come today" must never read as the letters O-R-U.
    expect(spelledWordsIn("oh are you able to come today")).toEqual([]);
  });

  it("keeps two spelled words apart", () => {
    expect(spelledWordsIn("s i o b h a n, then o k o n k w o")).toEqual(["siobhan", "okonkwo"]);
  });

  it("ignores a run too short to be a name", () => {
    expect(spelledWordsIn("it's on 5th, a b")).toEqual([]);
  });
});

describe("reducePhoneticSpelling", () => {
  it("touches nothing in ordinary speech", () => {
    const said = "my kitchen sink is leaking and I need someone for the weekend";
    expect(reducePhoneticSpelling(said)).toBe(said);
  });
});
