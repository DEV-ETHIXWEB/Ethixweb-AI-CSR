import {
  addressDisputeNote,
  addressReadbackNote,
  buildCallNotes,
  formatCallNotes,
} from "./call-notes";

/**
 * Shapes taken from real calls (the previous vendor's October calls and our
 * own test calls). Names, numbers and addresses here are invented.
 */
describe("buildCallNotes", () => {
  it("keeps a name the caller spelled out, letter by letter, instead of a re-guessed one", () => {
    const notes = buildCallNotes([
      "okay renata r e n a t a last name is kowal k o w a l",
      "it's for the kitchen sink",
    ]);
    expect(notes.spelledName).toEqual(["renata", "kowal"]);
    expect(formatCallNotes(notes)).toContain('R-E-N-A-T-A K-O-W-A-L, which is "Renata Kowal"');
  });

  it("uses the latest stated name, so a correction wins", () => {
    const notes = buildCallNotes(["i have steve", "my name is judith"]);
    expect(notes.statedName).toBe("Judith");
  });

  it("does not take ordinary words after 'this is' as a name", () => {
    expect(buildCallNotes(["this is urgent, water everywhere"]).statedName).toBeNull();
    expect(buildCallNotes(["well the thing is this is urgent"]).statedName).toBeNull();
    expect(buildCallNotes(["hi this is dana"]).statedName).toBe("Dana");
    // Found by the turn-handler suite: "call me back" was read as the name "Back".
    expect(buildCallNotes(["no problem, call me back"]).statedName).toBeNull();
  });

  it("captures a full street address and keeps the direction", () => {
    const notes = buildCallNotes(["well the street is one nine one two eleventh avenue west"]);
    expect(notes.street).toBe("1912 eleventh avenue west");
    const digits = buildCallNotes(["it's 4410 12th avenue west, seattle"]);
    expect(digits.street).toBe("4410 12th avenue west");
  });

  it("joins an address that arrived in two pieces", () => {
    const notes = buildCallNotes(["3810", "248th place south kent"]);
    expect(notes.street).toBe("3810 248th place south");
  });

  it("captures a ZIP read out digit by digit, but never a house number", () => {
    expect(buildCallNotes(["nine eight one one nine"]).zip).toBe("98119");
    expect(buildCallNotes(["14210 196th avenue east"]).zip).toBeNull();
    expect(buildCallNotes(["98012 main street"]).zip).toBeNull();
    expect(buildCallNotes(["the zip is 30301"]).zip).toBe("30301");
  });

  it("captures the callback number the caller gave", () => {
    expect(buildCallNotes(["801 555 0142"]).phone).toBe("8015550142");
  });

  it("captures home or business so it is never asked three times", () => {
    expect(buildCallNotes(["yes home", "it's residential"]).property).toBe("home");
    expect(buildCallNotes(["it's for my restaurant"]).property).toBe("business");
  });

  it("captures timing the caller already gave", () => {
    expect(buildCallNotes(["as soon as possible"]).timing).toBe("as soon as possible");
  });

  it("produces no note before the caller has said anything useful", () => {
    expect(formatCallNotes(buildCallNotes(["hi", "my sink is leaking"]))).toBeNull();
  });

  it("tells the model not to re-ask and not to restart", () => {
    const text = formatCallNotes(buildCallNotes(["my name is dana", "the zip is 98119"]));
    expect(text).toContain("Never ask again for anything listed here");
    expect(text).toContain("never restart the intake");
    expect(text).toContain("ZIP: 9-8-1-1-9");
  });

  it("QA 2026-10-13: a bare answer to 'What's your name?' counts as the name", () => {
    const turns = [
      { speaker: "agent", text: "Can I get your name?" },
      { speaker: "caller", text: "Ravi Mehta." },
    ];
    expect(buildCallNotes(["Ravi Mehta."], turns).statedName).toBe("Ravi Mehta");
    expect(
      buildCallNotes(["the water line"], [turns[0]!, { speaker: "caller", text: "the water line" }])
        .statedName,
    ).toBeNull();
  });

  it("notes that a spelling was already asked for, so it is never asked twice (QA 2026-10-13)", () => {
    const text = formatCallNotes(
      buildCallNotes(
        ["my name is ravi"],
        [{ speaker: "agent", text: "Could you spell your last name for me?" }],
      ),
    );
    expect(text).toContain("you already asked for a spelling once");
  });
});

describe("2026-10-15: spelled name split when stated name has multiple words", () => {
  it("splits 'kentjohn' into 'kent' and 'john' when stated name was 'Kings John'", () => {
    const notes = buildCallNotes(["yes my name is kings john", "k e n t j o h n"]);
    expect(notes.spelledName).toEqual(["kent", "john"]);
  });

  it("does not split when stated name has one word", () => {
    const notes = buildCallNotes(["my name is peterson", "p e t e r s o n"]);
    expect(notes.spelledName).toEqual(["peterson"]);
  });

  it("does not split when lengths diverge too much", () => {
    const notes = buildCallNotes(["my name is al jones", "a l e x a n d e r"]);
    expect(notes.spelledName).toEqual(["alexander"]);
  });
});

describe("addressReadbackNote (QA 2026-10-13: a volunteered address was ignored)", () => {
  it("asks for a read-back when the caller just gave a full address", () => {
    const note = addressReadbackNote(
      ["My name is Pat Lee.", "It's 1912 9th Avenue West, Seattle, 98119."],
      ["Is it leaking right now?"],
    );
    expect(note).toContain("read it back once");
    expect(note).toContain("9-8-1-1-9");
  });

  it("uses oh for zeros in the ZIP readback", () => {
    const note = addressReadbackNote(["It's 3810 248th Place South, Seattle, 98101."], []);
    expect(note).toContain("9-8-1-oh-1");
  });

  it("asks for the ZIP when the address has none", () => {
    expect(addressReadbackNote(["3810 248th Place South, Kent."], [])).toContain("ask for the ZIP");
  });

  it("stays quiet once the address has been read back", () => {
    expect(
      addressReadbackNote(
        ["It's 1912 9th Avenue West, Seattle, 98119.", "yes"],
        ["So that's 1912 9th Avenue West?"],
      ),
    ).toBeNull();
  });

  it("stays quiet when there is no address", () => {
    expect(addressReadbackNote(["my sink is leaking"], [])).toBeNull();
  });

  it("gives a brief correction note when the agent already read back a different address", () => {
    const note = addressReadbackNote(
      ["It's 6204 Main Street.", "No, it's 6240 Main Street."],
      ["So that's 6-2-oh-4 Main Street?"],
    );
    expect(note).toContain("corrected");
    expect(note).toContain("6-2-4-oh main street");
    expect(note).not.toContain("read it back once");
  });
});

/**
 * 2026-10-22 tester call: a kitchen sink and a toilet, both raised in one
 * call. Asked "both are booked, not one, right?", Grace answered that "both
 * of the toilets" would be looked at: two separate problems collapsed into
 * one, and the wrong one. Nothing in these notes had ever carried what the
 * call was actually about.
 */
describe("several problems in one call", () => {
  it("lists each fixture the caller named, in their own words", () => {
    const notes = buildCallNotes([
      "my kitchen sink is leaking",
      "and the toilet upstairs keeps running",
    ]);
    expect(notes.fixtures).toEqual(["kitchen sink", "toilet"]);
    const text = formatCallNotes(notes);
    expect(text).toContain("kitchen sink; toilet");
    expect(text).toContain("never let one stand for the other");
    // The problems must sit OUTSIDE "never ask again for anything listed
    // here", which is right for a name or an address and badly wrong for a
    // problem: it would stop Grace asking whether the leak is running now.
    expect(text).toContain("Questions about each problem are still welcome");
    const neverAskAgain = text!.indexOf("Never ask again");
    expect(neverAskAgain === -1 || text!.indexOf("kitchen sink; toilet") > neverAskAgain).toBe(
      true,
    );
  });

  it("still says it when the problems are all the caller has given so far", () => {
    const text = formatCallNotes(
      buildCallNotes(["my kitchen sink is leaking and the toilet keeps running"]),
    );
    expect(text).toContain("more than one separate problem");
  });

  it("does not count the same fixture twice, and prefers the qualified name", () => {
    expect(buildCallNotes(["the sink is clogged", "the kitchen sink again"]).fixtures).toEqual([
      "kitchen sink",
    ]);
  });

  it("says nothing extra on a one-problem call, which was never broken", () => {
    const notes = buildCallNotes(["my water heater is leaking"]);
    expect(notes.fixtures).toEqual(["water heater"]);
    expect(formatCallNotes(notes)).toBeNull();
  });

  it("caps the list so the note stays short enough to be read", () => {
    expect(
      buildCallNotes(["the toilet, the sink, the shower and the dishwasher are all backed up"])
        .fixtures,
    ).toHaveLength(3);
  });
});

/**
 * 2026-10-22 tester call: "I kept saying that address is something else but
 * it didn't pay attention to it and kept on moving like you are all set."
 * addressReadbackNote only ever handled a correction that arrived as a whole
 * parseable address; real corrections rarely do.
 */
describe("addressDisputeNote", () => {
  const readback = "So that's 4-5-1-2 Maple Street, 9-8-0-3-2?";

  it.each([
    "no, that's not my address",
    "that's the wrong address",
    "my address is different",
    "I said four five one two",
    "no, it's Maple, not Main",
  ])("catches the correction %p", (said) => {
    expect(addressDisputeNote([said], [readback])).toContain("service address is wrong");
  });

  it("catches a dispute stated in words even with no readback before it", () => {
    expect(addressDisputeNote(["you've got the wrong street"], ["Can I get your name?"])).toContain(
      "service address is wrong",
    );
  });

  it("tells the model to stop treating the street in the notes as confirmed", () => {
    const note = addressDisputeNote(["no that's wrong"], [readback])!;
    expect(note).toContain("ignore it");
    expect(note).toContain("do not say they are all set");
  });

  it.each([
    ["no hot water", readback],
    ["no rush", readback],
    ["no idea", readback],
    ["no", "Is it leaking right now?"],
    ["no, it's my home", "Is this for a home or a business?"],
    ["yes that's right", readback],
  ])("does not fire on %p, which is not a correction", (said, lastReply) => {
    expect(addressDisputeNote([said], [lastReply])).toBeNull();
  });
});

/**
 * 2026-10-22 tester call: a hard name, spelled out, still not captured.
 * See spelled-letters.ts for the two spelling shapes that produced nothing.
 */
describe("a hard name spelled out", () => {
  it("captures a name spelled with the 'S for Sam' convention", () => {
    const notes = buildCallNotes([
      "s for sam, i for india, o for oscar, b for boy, h for harry, a for apple, n for nancy",
    ]);
    expect(notes.spelledName).toEqual(["siobhan"]);
    expect(formatCallNotes(notes)).toContain("S-I-O-B-H-A-N");
  });

  it("captures letter names once Grace has asked for the spelling", () => {
    const notes = buildCallNotes(
      ["oh kay oh en kay double u oh"],
      [
        { speaker: "agent", text: "Could you spell that for me?" },
        { speaker: "caller", text: "oh kay oh en kay double u oh" },
      ],
    );
    expect(notes.spelledName?.[0]).toContain("okonk");
  });

  it("does not read letter names as a spelling when nobody asked", () => {
    expect(buildCallNotes(["oh are you able to come out this week"]).spelledName).toBeNull();
  });
});

/**
 * 2026-10-22, second tester (Yash): "there are few instances where the csr
 * still guesses big names - i tried with mexican, caucasian and black names
 * (the main races living in seatle)".
 *
 * The first attempt at this asked the caller to spell any name of seven
 * characters or more. That was the wrong instrument twice over: it missed
 * every short name from any region (Jose, Luz, Kwame) while adding a
 * question for common long ones, and a length rule cannot tell which names
 * a model will guess at. The letters of what was actually HEARD are handed
 * over instead, which covers every region identically and asks the caller
 * for nothing.
 */
describe("a name she only has by ear", () => {
  it.each([
    ["Siobhan", "S-I-O-B-H-A-N"],
    ["Okonkwo", "O-K-O-N-K-W-O"],
    ["Xochitl", "X-O-C-H-I-T-L"],
    ["Jose", "J-O-S-E"],
    ["Luz", "L-U-Z"],
    ["Kwame", "K-W-A-M-E"],
    ["Tom", "T-O-M"],
  ])("hands over the exact letters of %p, whatever its length or origin", (name, letters) => {
    const text = formatCallNotes(buildCallNotes([`my name is ${name}`]))!;
    expect(text).toContain(letters);
    expect(text).toContain("never a different or more familiar-sounding");
  });

  it("spells both names when two were given", () => {
    const text = formatCallNotes(buildCallNotes(["my name is Jose Hernandez"]))!;
    expect(text).toContain("J-O-S-E, H-E-R-N-A-N-D-E-Z");
  });

  it("prefers the caller's own spelling once they have given one", () => {
    const text = formatCallNotes(buildCallNotes(["my name is Siobhan, s i o b h a n"]))!;
    expect(text).toContain("spelled out by the caller: S-I-O-B-H-A-N");
    expect(text).not.toContain("name as heard");
  });
});

/**
 * Phase 2 of the 2026-10-22 pre-handover recheck: the whole address path,
 * form by form, rather than assumed. These are the shapes real callers use.
 */
describe("every address form a caller actually uses", () => {
  const street = (said: string) => buildCallNotes([said]).street;

  it.each([
    ["4512 maple street", "4512 maple street"],
    ["4512 maple st", "4512 maple st"],
    ["1912 9th avenue west", "1912 9th avenue west"],
    ["13005 se 245th street", "13005 se 245th street"],
    ["3810 248th place south", "3810 248th place south"],
    ["4512 south maple street", "4512 south maple street"],
    ["4512 maple boulevard southeast", "4512 maple boulevard southeast"],
    ["my address is 4512 maple street in kent", "4512 maple street"],
    ["4512 maple street, kent, washington 98032", "4512 maple street"],
    // Compound spoken numbers — see service-area.spec.ts.
    ["forty five twelve maple street", "4512 maple street"],
    ["four five one two maple street", "4512 maple street"],
    // Units, which used to be dropped entirely.
    ["4512 maple street apartment b", "4512 maple street apartment b"],
    ["4512 maple street apt 2b", "4512 maple street apt 2b"],
    ["4512 maple street unit 304", "4512 maple street unit 304"],
  ])("reads %p", (said, expected) => {
    expect(street(said)).toBe(expected);
  });

  it.each([
    // A unit word with nothing after it is a caller mid-sentence.
    ["4512 maple street apartment", "4512 maple street"],
  ])("is careful with %p", (said, expected) => {
    expect(street(said)).toBe(expected);
  });

  it.each([
    // KNOWN AND DELIBERATE: no street type means no address. Accepting
    // "<number> <word>" would read "4512 and my zip is..." as a street, and
    // a wrong street is worse than asking for it — which the save gate makes
    // Grace do anyway.
    ["it's 4512 maple"],
    ["it's on maple street, number 4512"],
    ["p o box 123"],
    // A house number and a numbered street run together with no pause comes
    // out as one long number that no street parses from, so Grace asks for
    // the two parts separately (prompt v55 owns that wording) instead of
    // asserting the wrong one.
    ["fifty three twelve one fifty six drive northeast"],
  ])("takes no address from %p, and asks instead", (said) => {
    expect(street(said)).toBeNull();
  });

  it("keeps the ZIP alongside the street", () => {
    const notes = buildCallNotes(["4512 maple street apartment b, kent, 98032"]);
    expect(notes.street).toBe("4512 maple street apartment b");
    expect(notes.zip).toBe("98032");
  });
});
