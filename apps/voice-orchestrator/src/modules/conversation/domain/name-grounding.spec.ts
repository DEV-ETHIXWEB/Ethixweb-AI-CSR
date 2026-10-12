import { NAME_NOT_GIVEN_ERROR, isNameGroundedInCaller } from "./name-grounding";

describe("isNameGroundedInCaller", () => {
  it("accepts a name the caller said, including mid-sentence", () => {
    expect(isNameGroundedInCaller("Priya", ["so my name is Priya Shah and my toilet runs"])).toBe(
      true,
    );
  });

  it("accepts a one-letter speech-to-text spelling difference", () => {
    expect(isNameGroundedInCaller("Anna", ["my name is Ana"])).toBe(true);
  });

  it("accepts a name the caller spelled out letter by letter", () => {
    expect(isNameGroundedInCaller("Priya", ["it's P R I Y A"])).toBe(true);
  });

  it("rejects a name the caller never said", () => {
    expect(
      isNameGroundedInCaller("Robert", ["my water heater is leaking", "it's actively leaking"]),
    ).toBe(false);
  });

  it("rejects placeholder names even if the caller said the word", () => {
    expect(isNameGroundedInCaller("Unknown", ["I am an unknown caller"])).toBe(false);
    expect(isNameGroundedInCaller("Caller", ["the caller said hi"])).toBe(false);
  });

  it("rejects an empty or one-letter name", () => {
    expect(isNameGroundedInCaller("", ["hello"])).toBe(false);
    expect(isNameGroundedInCaller("A", ["a"])).toBe(false);
  });

  describe("client feedback (Prateek, 2026-10-09): a refused name sent Grace back to the first question", () => {
    it("accepts the model's spelling of a name speech-to-text wrote the way it sounds", () => {
      expect(isNameGroundedInCaller("Prateek", ["yeah my name is pratik"])).toBe(true);
      expect(isNameGroundedInCaller("Pratik", ["it's prateek"])).toBe(true);
      expect(isNameGroundedInCaller("Stephen", ["this is steven"])).toBe(true);
      expect(isNameGroundedInCaller("Mohammed", ["i'm muhamad"])).toBe(true);
    });

    it("keeps short names strict, so ordinary words never pass as a name", () => {
      expect(isNameGroundedInCaller("Tom", ["what time can you come"])).toBe(false);
      expect(isNameGroundedInCaller("Dan", ["and the drain is slow"])).toBe(false);
      expect(isNameGroundedInCaller("Sarah", ["sure, the sink is leaking"])).toBe(false);
    });

    it("still rejects a long name the caller never said", () => {
      expect(isNameGroundedInCaller("Prateek", ["my kitchen sink is leaking"])).toBe(false);
      expect(isNameGroundedInCaller("Jonathan", ["my water heater is leaking"])).toBe(false);
    });

    it("tells the model to keep what it already has instead of starting over", () => {
      expect(NAME_NOT_GIVEN_ERROR.detail).toContain("do not ask for any of it again");
      expect(NAME_NOT_GIVEN_ERROR.detail).not.toContain("has not told you their name");
    });
  });
});
