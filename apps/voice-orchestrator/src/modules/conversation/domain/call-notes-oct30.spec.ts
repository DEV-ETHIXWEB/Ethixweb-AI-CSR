import { buildCallNotes } from "./call-notes";

// 2026-10-30, Prateek's test calls on the live line.

// "it's not eight three one two it's three three one two": the notes kept
// 8312, Grace read 8312 back again, and 8312 was saved.
describe("Prateek, 2026-10-30: 'not X it's Y' corrects the house number", () => {
  it("is 3312", () => {
    const notes = buildCallNotes([
      "okay the street address would be eight three one two thirty fourth avenue south seattle washington nine eight one four four",
      "repeat",
      "it's not eight three one two it's three three one two",
    ]);
    expect(notes.street).toBe("3312 thirty fourth avenue south");
  });

  it("the older 'X not Y' order still works", () => {
    const notes = buildCallNotes([
      "it's twelve fifteen north ninety second street",
      "no sorry it's twelve fifty not twelve fifteen",
    ]);
    expect(notes.street?.startsWith("1250 ")).toBe(true);
  });
});

// Same session: "it's not greeny avenue it's finney finney avenue". The notes
// kept "greenny avenue north".
describe("Prateek, 2026-10-30: 'not this street, it's that one' renames the street", () => {
  it("is 5512 finney avenue north", () => {
    const notes = buildCallNotes([
      "it's five five one two greenny avenue north seattle washington nine eight one zero three",
      "it's not greeny avenue it's finney finney avenue",
    ]);
    expect(notes.street).toBe("5512 finney avenue north");
    expect(notes.zip).toBe("98103");
  });
});
