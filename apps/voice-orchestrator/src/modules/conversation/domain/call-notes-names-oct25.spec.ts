import {
  addressDisputeNote,
  buildCallNotes,
  formatCallNotes,
  nameRepeatedNote,
} from "./call-notes";

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

describe("2026-10-25 test calls: an address with no street type is still an address", () => {
  it.each([
    [
      "okay it's five one four west main nine eight three seven one washington bye",
      "514 west main",
    ],
    [
      "with the street address is five four zero seven southford port seattle nine eight one one eight",
      "5407 southford port",
    ],
    ["it's 1200 pine street seattle 98101", "1200 pine street"],
  ])("%p", (said, street) => {
    expect(buildCallNotes([said]).street).toBe(street);
  });

  it.each(["i have 3 kids 98101", "seattle washington nine eight zero two one"])(
    "but not %p",
    (said) => {
      expect(buildCallNotes([said]).street).toBeNull();
    },
  );
});

describe('2026-10-25 test call: "no" to a read-back of both name and address', () => {
  it("asks which one is wrong", () => {
    const note = addressDisputeNote(
      ["well it's five four zero seven south hood court seattle nine eight one one eight", "no"],
      [
        "Let me make sure I have it right: Donald, D-O-N-A-L-D, Burke, B-U-R-K-E, at 5-4-oh-7 south hood court, ZIP 9-8-1-1-8. Is that right?",
      ],
    )!;
    expect(note).toContain("the name or the address");
  });

  it("an address-only read-back still asks for the part of the address", () => {
    const note = addressDisputeNote(
      ["4512 maple street", "no"],
      ["So that's 4-5-1-2 Maple Street, 9-8-0-3-2?"],
    )!;
    expect(note).toContain("service address is wrong");
  });
});

describe("2026-10-25, replaying every recorded call", () => {
  it.each([
    ["i'm doing good i wanted to know what kind of information do you have"],
    ["same as i am if you can repeat my address"],
    ["but i'm lonely"],
  ])("%p is no name", (said) => {
    expect(nameAfter([said])).toBeNull();
  });

  it.each([
    ["hey grace this is jordan quick question before i book anything", "Jordan"],
    ["hi grace this is george cancel my appointment", "George"],
  ])("%p is %p", (said, name) => {
    expect(nameAfter([said])).toBe(name);
  });

  it('"add it" answering "your last name?" is no surname', () => {
    expect(
      nameAfter(
        ["hey my name is paul and i need a gas line installed", "add it"],
        ["Got it. Can I get your last name, Paul?"],
      ),
    ).toBe("Paul");
  });

  it.each([
    ["twelve hundred pine street seattle", "1200 pine street"],
    ["two hundred and five main street", "205 main street"],
  ])("%p is the street %p", (said, street) => {
    expect(buildCallNotes([said]).street).toBe(street);
  });

  it("a house number, then a numbered street said as a number", () => {
    expect(
      buildCallNotes(["well fifty three one two", "one hundred fifty six drive northeast"]).street,
    ).toBe("5312 156th drive northeast");
  });
});

describe("2026-10-25, replaying every recorded call: what is not a street", () => {
  it.each([
    "oh by the way is someone coming today",
    "two oh four not two oh four six two oh four fifteenth avenue northeast",
    "nine two two zero eight ave nine eight one zero three",
  ])("%p", (said) => {
    expect(buildCallNotes([said]).street ?? "").not.toMatch(/^0 |by the way| not | ave$/);
  });

  it("still finds the street in a correction said in full", () => {
    expect(buildCallNotes(["no it's six two zero four fifteenth avenue northeast"]).street).toBe(
      "6204 fifteenth avenue northeast",
    );
  });
});

describe("2026-10-25, replaying every recorded call: what is not the name said again", () => {
  it("a street name said twice, echoed back by Grace", () => {
    expect(
      nameRepeatedNote(
        ["yes", "twenty six fifty four", "button", "button"],
        ["What's the street name?", "Button, is that B, U, T, T, O, N?"],
        null,
      ),
    ).toBeNull();
  });

  it.each([
    [["my name is petronella tasquez", "it's vasquez"]],
    [["hey grace this is jordan", "it's wiki patrick fossett and just to be clear"]],
  ])("%p", (callerTexts) => {
    expect(nameRepeatedNote(callerTexts, ["Got it."], null)).toBeNull();
  });

  it("but a name said again is", () => {
    expect(
      nameRepeatedNote(["my name is kevin dunn", "kevin kevin dunn it's kevin dunn"], ["Got it."]),
    ).toContain("spell their first name");
  });
});

describe("a sales pitch is not a problem (real-model QA, vendor-08)", () => {
  it("leaves the pitch out of what they called about", () => {
    const notes = formatCallNotes(
      buildCallNotes([
        "Hi, it's Mapcard Business. We help local plumbing shops get more calls.",
        "We do Google visibility and AI phone agents for shops like yours.",
      ]),
    );
    expect(notes ?? "").not.toContain("What they called about");
  });
});

describe("2026-10-26, real-model QA: a place is not a name", () => {
  it.each(["Beverly Hills, California.", "Portland, Oregon."])("%p", (said) => {
    expect(nameAfter([said], [])).toBeNull();
    expect(
      buildCallNotes(
        ["my toilet is overflowing", said],
        [
          { speaker: "caller", text: "my toilet is overflowing" },
          { speaker: "agent", text: "Can I get your name?" },
          { speaker: "caller", text: said },
        ],
      ).statedName,
    ).toBeNull();
  });
});
