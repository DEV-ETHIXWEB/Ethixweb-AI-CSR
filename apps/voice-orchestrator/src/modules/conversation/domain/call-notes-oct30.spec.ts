import { buildCallNotes, formatCallNotes } from "./call-notes";

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

type Turn = { speaker: string; text: string };
const notesAfter = (turns: Turn[]) =>
  buildCallNotes(
    turns.filter((turn) => turn.speaker === "caller").map((turn) => turn.text),
    turns,
  );

// "walter is my first name n kosi n k o s i is my middle name and brian is my
// last name" became first name "Nkosi" with no last name; Grace read back
// only "Nkosi" and saved "Nkosi".
describe("Prateek, 2026-10-30: name parts the caller labels are those parts", () => {
  it("is Walter Nkosi Brian, and stays so after 'yes'", () => {
    const turns: Turn[] = [
      {
        speaker: "agent",
        text: "Got it, a broken kitchen faucet handle. Can I get your name, please?",
      },
      { speaker: "caller", text: "my name is walter" },
      { speaker: "caller", text: "nkosi" },
      {
        speaker: "agent",
        text: "Got it, Walter, W-A-L-T-E-R, Nkosi, N-K-O-S-I. Can I get your service address, please?",
      },
      { speaker: "caller", text: "brian" },
      {
        speaker: "caller",
        text: "it's walter and ncosi middle name and last name is brian p r y a n",
      },
      {
        speaker: "agent",
        text: "Just to confirm, is it Walter Pryan, first name Walter, last name Pryan, P-R-Y-A-N?",
      },
      { speaker: "caller", text: "no no it's walter ecosi lion" },
      {
        speaker: "agent",
        text: "I have Walter as your first name. Can I get your last name, please?",
      },
      {
        speaker: "caller",
        text: "walter is my first name n kosi n k o s i is my middle name and brian is my last name",
      },
    ];
    expect(notesAfter(turns).spelledName).toEqual(["walter", "nkosi", "brian"]);
    const after = notesAfter([
      ...turns,
      {
        speaker: "agent",
        text: "Your first name is Walter, middle name Nkosi, last name Brian. Is that correct?",
      },
      { speaker: "caller", text: "yes yes yes finally you worked that right man" },
    ]);
    expect(after.statedName).toBe("Walter Nkosi Brian");
  });

  it("'my first name is ... my middle name is ... and my last name is ...'", () => {
    const notes = notesAfter([
      { speaker: "agent", text: "Can I get your name?" },
      {
        speaker: "caller",
        text: "my first name is petronella my middle name is elena and my last name is vasquez",
      },
    ]);
    expect(notes.statedName).toBe("Petronella Elena Vasquez");
  });

  it("a labelled last name keeps the first name already given", () => {
    const notes = notesAfter([
      { speaker: "agent", text: "Can I get your name?" },
      { speaker: "caller", text: "it's cassandra" },
      { speaker: "agent", text: "Got it, Cassandra. What's your last name?" },
      { speaker: "caller", text: "my last name is oakley o a k l e y" },
    ]);
    expect(notes.statedName).toBe("Cassandra Oakley");
  });

  it("asking what their last name is, is not giving one", () => {
    const notes = notesAfter([
      { speaker: "agent", text: "Can I get your name?" },
      { speaker: "caller", text: "it's cassandra oakley" },
      { speaker: "agent", text: "Thanks, Cassandra. What's the address?" },
      { speaker: "caller", text: "what is my last name" },
    ]);
    expect(notes.statedName).toBe("Cassandra Oakley");
  });
});

// Replaying all 401 recorded calls with the change above.
describe("labelled name parts, from earlier recorded calls", () => {
  it("'my first name is ami ...' then 'my last name is ... g o r e n s t e i n' is Ami Gorenstein", () => {
    const notes = notesAfter([
      { speaker: "agent", text: "What's your name?" },
      { speaker: "caller", text: "my first name is ami a double m i" },
      { speaker: "caller", text: "and my last name is borrenstein g o r e n s t e i n" },
    ]);
    expect(notes.statedName).toBe("Ami Gorenstein");
  });

  it("letters spelled before the word win: 'my last name is o y e l a r a n oylaran'", () => {
    const notes = notesAfter([
      { speaker: "agent", text: "What's your name?" },
      { speaker: "caller", text: "well my name is barnaby" },
      { speaker: "agent", text: "Thanks for that, Barnaby. Can you provide your street address?" },
      { speaker: "caller", text: "excellent but only my last name is o y e l a r a n oylaran" },
    ]);
    expect(notes.statedName).toBe("Barnaby Oyelaran");
  });
});

// "it's cassandra", Grace asked for the address, and "oakley" came straight
// after. The last name was dropped; she had to say it twice more.
describe("Prateek, 2026-10-30: a lone word straight after a first name", () => {
  const cassandra: Turn[] = [
    { speaker: "agent", text: "Got it; thanks for sharing that. Can I get your name, please?" },
    { speaker: "caller", text: "it's cassandra" },
    { speaker: "agent", text: "Got it, Cassandra, C-A-S-S-A-N-D-R-A. What's the service address?" },
    { speaker: "caller", text: "oakley" },
  ];

  it("is offered as the last name to confirm", () => {
    const notes = notesAfter(cassandra);
    expect(notes.lastNameMaybe).toBe("Oakley");
    expect(formatCallNotes(notes)).toContain('"Is Oakley your last name?"');
  });

  it("stays offered on the next turn", () => {
    const notes = notesAfter([
      ...cassandra,
      { speaker: "agent", text: "Thanks for that, Cassandra. What's the street address?" },
      { speaker: "caller", text: "what's my second name" },
    ]);
    expect(notes.lastNameMaybe).toBe("Oakley");
  });

  it("not when a last name is already known, a number, or a unit word", () => {
    const named = notesAfter([
      { speaker: "agent", text: "Can I get your name?" },
      { speaker: "caller", text: "it's cassandra oakley" },
      { speaker: "agent", text: "What's the service address?" },
      { speaker: "caller", text: "seattle" },
    ]);
    expect(named.lastNameMaybe).toBeUndefined();
    for (const said of ["unit", "eight three one two", "yes"]) {
      const notes = notesAfter([...cassandra.slice(0, 3), { speaker: "caller", text: said }]);
      expect(notes.lastNameMaybe).toBeUndefined();
    }
  });
});

// "okay sorry i'm back so the it it is clock bathroom sink" ("it's a clogged
// bathroom sink") gave the name Clock, and Grace said "Thanks for that, Clock".
describe("Prateek, 2026-10-30: a word straight before a fixture is not a name", () => {
  it("'it is clock bathroom sink' gives no name", () => {
    const notes = notesAfter([
      {
        speaker: "caller",
        text: "so i might need you to pause okay the issue is my bathroom sink is clogged and one second one second",
      },
      {
        speaker: "agent",
        text: "Sure, take your time. Is the sink currently overflowing or just draining slowly?",
      },
      { speaker: "caller", text: "okay sorry i'm back so the it it is clock bathroom sink" },
    ]);
    expect(notes.statedName).toBeNull();
  });

  it("'hey it's maria' and 'it's maria and the kitchen sink is clogged' are still names", () => {
    expect(notesAfter([{ speaker: "caller", text: "hey it's maria" }]).statedName).toBe("Maria");
    expect(
      notesAfter([{ speaker: "caller", text: "it's maria and the kitchen sink is clogged" }])
        .statedName,
    ).toBe("Maria");
  });
});
