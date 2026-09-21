import { isNameGroundedInCaller } from "./name-grounding";

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
});
