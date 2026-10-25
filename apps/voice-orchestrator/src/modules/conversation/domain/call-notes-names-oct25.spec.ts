import { buildCallNotes, formatCallNotes } from "./call-notes";

/**
 * 2026-10-25, the client's test calls: every name below was saved or said
 * back by Grace ("Old", "This", "Yru", "Uur", "Bear", "Plus", "Chris Said",
 * "Berg", "Vasquezyru"). A name already given is not replaced by a word that
 * only follows "I am" / "it's" / "this is", common words are not letters, and
 * a spelled surname replaces only the surname.
 */
function nameAfter(callerTexts: string[], agentTexts: string[] = []): string | null {
  const turns = callerTexts.flatMap((text, index) => [
    { speaker: "caller", text },
    ...(agentTexts[index] ? [{ speaker: "agent", text: agentTexts[index] }] : []),
  ]);
  const notes = buildCallNotes(callerTexts, turns);
  return notes.spelledName
    ? notes.spelledName.map((w) => w[0]!.toUpperCase() + w.slice(1)).join(" ")
    : notes.statedName;
}

const MICHAEL = "hi grace my name is michael";
const SPELL = "Could you spell your first name for me, letter by letter?";

describe("2026-10-25 test calls: names", () => {
  it.each([
    ["i am old i am old and i am not able to speak very fast so please be patient"],
    ["why are you visiting what you say mute why are you so mute"],
    ["i will not confirm anything this is this is the third time"],
    ["you you are welcome you are basically challenging me"],
    ["no i i am doing this i have one in my hand"],
    ["it's huge"],
    ["my father's name is dad my mother's name is bear"],
  ])("Michael stays Michael after %p", (said) => {
    expect(nameAfter([MICHAEL, "oh first let me finish", said], ["Got it, Michael.", SPELL])).toBe(
      "Michael",
    );
  });

  it("a spelled surname replaces only the surname", () => {
    expect(
      nameAfter(
        ["my name is donald", "berg p e r g", "name is donald burke b e r g not p"],
        ["Got it.", "Got it, Donald Perg. What's the service address?"],
      ),
    ).toBe("Donald Berg");
  });

  it("reading out a phone number is not a name", () => {
    expect(
      nameAfter(
        [
          "my name is donald burke",
          "one it's plus one eight seven two two seven eight four nine nine nine",
        ],
        ["What's the best number to reach you?"],
      ),
    ).toBe("Donald Burke");
  });

  it('letters after a spelling are not glued on from "why are you"', () => {
    const name = nameAfter(
      ["my name is petronella vasquez", "it's v a s q u e z", "why are you interrupting me again"],
      ["Got it.", SPELL],
    );
    expect(name).toBe("Petronella Vasquez");
  });

  it('"it\'s vasquez" corrects the surname, not the whole name', () => {
    expect(
      nameAfter(["my name is petronella tasquez", "it's vasquez"], ["Got it, Petronella Tasquez."]),
    ).toBe("Petronella Vasquez");
  });

  it('"said" is not a surname', () => {
    expect(
      nameAfter(["instead of hi this is chris said oh no no no please use that slower tone"]),
    ).not.toMatch(/said/i);
  });

  it("a shorter surname heard later does not cut a known one", () => {
    expect(
      nameAfter(
        ["my name is harold winterbone", "it's h a r o l d and the last name is winter bond"],
        [SPELL],
      ),
    ).toBe("Harold Winterbone");
  });
});

describe("2026-10-25 test calls: the problem is kept in the caller's own words", () => {
  it("keeps a problem that names no fixture, so Grace never asks for it again", () => {
    const turns = [
      { speaker: "agent", text: "Got it, Michael. What seems to be the problem today?" },
      {
        speaker: "caller",
        text: "so we have a galvanized half inch cold water pipe that was adapted to some copper and it ended up corroding the copper out",
      },
      { speaker: "agent", text: "Got it. Can I get the address?" },
      { speaker: "caller", text: "why did you interrupt me let me finish" },
    ];
    const callerTexts = turns.filter((t) => t.speaker === "caller").map((t) => t.text);
    const notes = formatCallNotes(buildCallNotes(callerTexts, turns))!;
    expect(notes).toContain("galvanized half inch cold water pipe");
    expect(notes).toContain("Never ask them what the problem is again");
    expect(notes).not.toContain("let me finish");
  });

  it("an intermittent leak in the basement", () => {
    const notes = formatCallNotes(
      buildCallNotes([
        "i have an intermittent leak in my basement and i need someone to look at it",
      ]),
    )!;
    expect(notes).toContain("intermittent leak in my basement");
  });
});
