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

// Yash, 2026-10-26: asked for the ZIP, "cms here" became the name Cms.
it("'cms here' is not a name", () => {
  const notes = buildCallNotes(
    ["my name's yes raj yeah", "cms here"],
    [
      { speaker: "agent", text: "Got it, that sounds urgent. What is your name?" },
      { speaker: "caller", text: "my name's yes raj yeah" },
      { speaker: "agent", text: "What's the ZIP code for 12 Maple Street?" },
      { speaker: "caller", text: "cms here" },
    ],
  );
  expect(notes.statedName ?? "").not.toMatch(/cms/i);
  expect(notes.spelledName ?? []).not.toContain("cms");
});

// Live test battery, 2026-10-26, after the fixes above.
describe("live battery, 2026-10-26", () => {
  it("'wing n g u y e n': the letters are the name, whatever the word was heard as", () => {
    const notes = buildCallNotes(
      ["it's felicity", "wing n g u y e n"],
      [
        { speaker: "agent", text: "Got it! Can I have your name, please?" },
        { speaker: "caller", text: "it's felicity" },
        {
          speaker: "agent",
          text: "Let me confirm that: Felicity, F-E-L-I-C-I-T-Y. Is that right?",
        },
        { speaker: "caller", text: "wing n g u y e n" },
      ],
    );
    expect(notes.statedName).toBe("Felicity Nguyen");
  });

  it("'no thanks' to a repeated read-back is not a dispute", () => {
    expect(
      addressDisputeNote(
        [
          "six six five zero roosevelt way northeast seattle nine eight one one five",
          "can you repeat my address back",
          "no thanks",
        ],
        [
          "[slowly] Sure! Let me make sure I have it right: Renata, R-E-N-A-T-A, at 6-6-5-oh Roosevelt Way Northeast, ZIP 9-8-1-1-5. Is that right?",
        ],
      ),
    ).toBeNull();
  });

  it("'desmond okaforbright o k a f o r dash b r i g h t' keeps Desmond", () => {
    const said =
      "desmond okaforbright o k a f o r dash b r i g h t two zero six three five zero nine nine eight one";
    const notes = buildCallNotes(
      [said],
      [
        {
          speaker: "agent",
          text: "Got it, your bathroom sink is draining slower. Can I get your name, please?",
        },
        { speaker: "caller", text: said },
      ],
    );
    expect(notes.statedName?.split(" ")[0]).toBe("Desmond");
    expect(notes.spelledName?.[0]).toBe("desmond");
  });
});

// Live battery: the name came in three pieces, and Grace said "Desmond Okafor".
it("a spelling of only the start of the last name does not shorten it", () => {
  const turns = [
    {
      speaker: "agent",
      text: "Got it, your bathroom sink is draining slowly. Can I get your name, please?",
    },
    { speaker: "caller", text: "desmond okaforbright" },
    { speaker: "caller", text: "o k a f o r dash" },
  ];
  const notes = buildCallNotes(
    turns.filter((t) => t.speaker === "caller").map((t) => t.text),
    turns,
  );
  expect(notes.statedName).toBe("Desmond Okaforbright");
  expect(notes.spelledName ?? ["desmond", "okaforbright"]).toEqual(["desmond", "okaforbright"]);
});

// Live battery, final run: three pieces, the middle word misheard, and the
// spelling split at "dash". Grace said "Got it, Okafor" and read back "Bright".
it("'desmond aquafor bright o k a f o r', then 'dash b r i g h t'", () => {
  const turns = [
    {
      speaker: "agent",
      text: "Got it, a slow-draining bathroom sink. Can I get your name, please?",
    },
    { speaker: "caller", text: "desmond aquafor bright o k a f o r" },
    { speaker: "agent", text: "Got it, Okafor. Now, can you give me the service address?" },
    { speaker: "caller", text: "dash b r i g h t" },
  ];
  const notes = buildCallNotes(
    turns.filter((t) => t.speaker === "caller").map((t) => t.text),
    turns,
  );
  expect(notes.spelledName).toEqual(["desmond", "okafor-bright"]);
});
