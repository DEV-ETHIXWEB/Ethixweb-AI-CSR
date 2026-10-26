import { addressDisputeNote, buildCallNotes } from "./call-notes";

type Turn = { speaker: string; text: string };
const notesAfter = (turns: Turn[]) =>
  buildCallNotes(
    turns.filter((turn) => turn.speaker === "caller").map((turn) => turn.text),
    turns,
  );

// 2026-10-26, Prateek's test calls on the live line.
describe("Prateek, 2026-10-26: a tough last name, spelled", () => {
  it("'nguyen n g u y e n' after the first name is the last name", () => {
    const notes = notesAfter([
      { speaker: "agent", text: "Sounds like a new garbage disposal. Can I get your name?" },
      { speaker: "caller", text: "it's felicity" },
      { speaker: "agent", text: "Got it, Felicity, F-E-L-I-C-I-T-Y. What is the service address?" },
      { speaker: "caller", text: "nguyen n g u y e n" },
    ]);
    expect(notes.statedName).toBe("Felicity Nguyen");
    expect(notes.spelledName).toEqual(["felicity", "nguyen"]);
  });

  it("a word and its own letters as the first answer is the first name", () => {
    const notes = notesAfter([
      { speaker: "agent", text: "Can I get your name?" },
      { speaker: "caller", text: "felicity f e l i c i t y" },
    ]);
    expect(notes.statedName).toBe("Felicity");
  });

  it("'it's pemberton p e m p e r t o n' corrects the last name and keeps Walter", () => {
    const notes = notesAfter([
      { speaker: "agent", text: "Ah, sounds like your drain is clogged. Can I get" },
      { speaker: "caller", text: "and my name is walter pemberton it's p e m p e r t over" },
      { speaker: "agent", text: "Got it, Walter. Can you give me your street address, please?" },
      { speaker: "caller", text: "it's it's not my train it's my bathtub and it is not raining" },
      {
        speaker: "agent",
        text: "Just to confirm, is your name Walter Pempert, spelled W-A-L-T-E-R P-E-M-P-E-R-T?",
      },
      { speaker: "caller", text: "it's pemberton p e m p e r t o n" },
    ]);
    expect(notes.statedName).toBe("Walter Pemberton");
    expect(notes.spelledName?.[0]).toBe("walter");
  });
});

// Same call: "seven seven three three pinwood avenue north ... nine eight one
// zero three", then, asked to spell the street, "okay it's greenwood avenue
// north". The ZIP was joined on as the house number: "98103 greenwood".
describe("Prateek, 2026-10-26: a corrected street name keeps the house number", () => {
  it("is 7733 greenwood avenue north", () => {
    const notes = buildCallNotes([
      "oh oh the address sorry it's seven seven three three pinwood avenue north seattle washington nine eight one zero three",
      "okay it's greenwood avenue north",
    ]);
    expect(notes.street).toBe("7733 greenwood avenue north");
    expect(notes.zip).toBe("98103");
  });

  it("a nearby street is not a correction", () => {
    const notes = buildCallNotes([
      "it's seven seven three three greenwood avenue north seattle nine eight one zero three",
      "it's near pine street",
    ]);
    expect(notes.street).toBe("7733 greenwood avenue north");
  });
});

// Same session: asked to repeat his address, Grace read it back and ended
// with "Is there anything else I can help with today?". His "no thanks"
// answered that, and Grace asked "What part of the address needs correcting?"
describe("Prateek, 2026-10-26: 'no' to 'anything else?' is not an address dispute", () => {
  const readback =
    "[slowly] Sure! Your name is Renata, at 6-6-5-oh Roosevelt Way Northeast, Seattle, ZIP 9-8-1-1-5. You have a kitchen sink issue and a toilet that keeps running nonstop. Is there anything else I can help with today?";

  it.each(["no thanks", "no", "nope that's all"])("%p", (said) => {
    expect(
      addressDisputeNote(["six six five zero roosevelt way northeast", said], [readback]),
    ).toBeNull();
  });

  it("a 'no' to the read-back question itself is still a dispute", () => {
    expect(
      addressDisputeNote(
        ["six six five zero roosevelt way northeast", "no"],
        [
          "Let me make sure I have it right: 6-6-5-oh Roosevelt Way Northeast, ZIP 9-8-1-1-5. Is that right?",
        ],
      ),
    ).not.toBeNull();
  });
});
