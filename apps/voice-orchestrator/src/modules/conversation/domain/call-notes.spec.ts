import {
  addressDisputeNote,
  nameDisputeNote,
  nameUpdateNote,
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
    const text = formatCallNotes(notes)!;
    expect(text).toContain("R-E-N-A-T-A K-O-W-A-L");
    // 2026-10-22: the first and last parts are named separately now, so the
    // model never splits a full name itself — see splitForFields.
    expect(text).toContain('first name "Renata", last name "Kowal"');
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
    expect(formatCallNotes(buildCallNotes(["hi", "are you there"]))).toBeNull();
  });

  /**
   * 2026-10-22: a problem IS something useful, and used to produce no note.
   * A caller who gave it in their opening breath then had it carried only by
   * message history, which compaction caps — see `problems` in formatCallNotes.
   */
  it("carries the problem from the moment the caller gives it", () => {
    expect(formatCallNotes(buildCallNotes(["hi", "my sink is leaking"]))).toContain(
      "What they called about: the sink",
    );
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
  /**
   * 2026-10-22, client call: "the system confirmed my address more than
   * three times, which is unnecessary and makes the call repetitive ... it
   * should only reconfirm it once, at the end of the call, just before
   * ending the conversation."
   *
   * So a complete address is taken quietly now. It is read back exactly
   * once, in the closing confirmation beside the name and the number (see
   * callbackNumberNote in save-readiness.spec.ts).
   */
  it("takes a complete address quietly, leaving the read-back to the close", () => {
    expect(
      addressReadbackNote(
        ["My name is Pat Lee.", "It's 1912 9th Avenue West, Seattle, 98119."],
        ["Is it leaking right now?"],
      ),
    ).toBeNull();
  });

  it("still asks for a missing ZIP, which is collecting rather than confirming", () => {
    const note = addressReadbackNote(["3810 248th Place South, Kent."], [])!;
    expect(note).toContain("ask for the ZIP");
    expect(note).toContain("that happens once at the end");
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

  it("states a single problem too, without the keep-them-separate rule", () => {
    const notes = buildCallNotes(["my water heater is leaking"]);
    expect(notes.fixtures).toEqual(["water heater"]);
    const text = formatCallNotes(notes)!;
    expect(text).toContain("What they called about: the water heater");
    expect(text).not.toContain("never let one stand for the other");
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

/**
 * 2026-10-22, Akash: "when a customer is telling everything at the starting
 * ... soon after it is asking the same and customer finds that it is just
 * not understanding", and "if CSR is asking name and on that time if
 * customer is telling the problem, that CSR is not understanding".
 *
 * Measured before changing anything: of nine realistic openings, FIVE lost
 * the caller's name entirely and one captured it wrongly.
 */
describe("a caller who says everything in their opening", () => {
  it.each([
    [
      "hi, I'm Tom Harris, my water heater is leaking at 4512 maple street kent 98032",
      "Tom Harris",
    ],
    ["yeah this is Dana Whitfield, the kitchen sink is backing up", "Dana Whitfield"],
    ["hello my name is Jose Hernandez, I have no hot water", "Jose Hernandez"],
    ["I'm Siobhan, my toilet is overflowing right now", "Siobhan"],
    ["I am Robert Chen, 1912 9th avenue west, the disposal is jammed", "Robert Chen"],
    ["hey it's Maria, my shower won't drain", "Maria"],
    // Speech recognition writes the contraction out in full often enough.
    ["it is Maria, my shower won't drain", "Maria"],
    ["Tom Harris here, water heater leaking", "Tom Harris"],
    ["Dana speaking, my sink is clogged", "Dana"],
    ["you're speaking with Akash, the drain is slow", "Akash"],
    ["call me Tom, the pipe burst", "Tom"],
  ])("takes the name out of %p", (opening, expected) => {
    expect(buildCallNotes([opening]).statedName).toBe(expected);
  });

  it("stops at a preposition instead of swallowing it as a surname", () => {
    // Captured "Tom At" before this.
    expect(buildCallNotes(["this is Tom at 4512 maple street, burst pipe"]).statedName).toBe("Tom");
  });

  it("takes the problem, the address and the urgency from that same opening", () => {
    const notes = buildCallNotes([
      "hi, I'm Tom Harris, my water heater is leaking at 4512 maple street kent 98032 and I need someone today",
    ]);
    expect(notes.statedName).toBe("Tom Harris");
    expect(notes.street).toBe("4512 maple street");
    expect(notes.zip).toBe("98032");
    expect(notes.fixtures).toEqual(["water heater"]);
    // Recorded, but never in the banned word — see neutralTiming.
    expect(notes.timing).toBe("today");
    expect(formatCallNotes(notes)).toContain("as soon as possible");
  });

  it.each([
    ["i'm calling about a leak"],
    ["i'm at 4512 maple street"],
    ["i'm not sure what happened"],
    ["i'm having a problem with the sink"],
    ["i'm trying to get someone out"],
    ["i'm looking for a quote"],
    ["i'm wondering if you cover kent"],
    ["it's leaking really badly"],
    ["it's the kitchen sink"],
    ["it's an emergency"],
    ["it's been going for an hour"],
    ["i'm good thanks"],
    ["i'm here"],
    ["i am done with it"],
    ["this is really bad"],
  ])("invents no name out of %p", (said) => {
    expect(buildCallNotes([said]).statedName).toBeNull();
  });

  it.each([
    ["my water heater"],
    ["the kitchen sink"],
    ["dishwasher"],
    ["washer"],
    ["boiler"],
    ["septic"],
    ["sump pump"],
    ["no hot water"],
    ["it's the disposal"],
    ["upstairs bathroom"],
  ])("does not take %p as a name when it answers the name question", (answer) => {
    const notes = buildCallNotes(
      [answer],
      [
        { speaker: "agent", text: "Can I get your name?" },
        { speaker: "caller", text: answer },
      ],
    );
    expect(notes.statedName).toBeNull();
  });
});

/**
 * 2026-10-22, Akash: "when I say a full name to it, it sometimes just take
 * my first name and say it like twice, so it adds my first name as first
 * name, and even last name." The notes handed over one string and left the
 * split to the model. A duplicate was already refused at the save, so the
 * record stayed clean — but the caller heard the wrong name.
 */
describe("a full name is split for the model, not by it", () => {
  it.each([
    ["my name is Tom Harris", 'first name "Tom", last name "Harris"'],
    ["hi I'm Jose Hernandez, the sink is clogged", 'first name "Jose", last name "Hernandez"'],
    ["this is Dana Whitfield", 'first name "Dana", last name "Whitfield"'],
  ])("names both halves of %p", (said, expected) => {
    const text = formatCallNotes(buildCallNotes([said]))!;
    expect(text).toContain(expected);
    expect(text).toContain("never the same word as both");
  });

  it("says plainly when there is only a first name, so it is not duplicated", () => {
    const text = formatCallNotes(buildCallNotes(["my name is Tom"]))!;
    expect(text).toContain("that is a FIRST name only");
    expect(text).toContain("leave the last name empty");
    expect(text).toContain('never repeat "Tom" as both');
  });

  it("splits a spelled name the same way", () => {
    const text = formatCallNotes(buildCallNotes(["s i o b h a n, o k o n k w o"]))!;
    expect(text).toContain('first name "Siobhan", last name "Okonkwo"');
  });
});

/**
 * 2026-10-22, client call: "when I introduced myself and later asked to
 * update my name to [NEW NAME], the system updated it on its own. However,
 * when I said goodbye at the end of the call, it still used my old name."
 *
 * Two faults behind it. The change was never recognised as a name statement
 * at all, and a spelled name beat a stated one unconditionally, so the first
 * name stood for the rest of the call however many times it was corrected.
 */
describe("a caller who changes their name mid-call", () => {
  it.each([
    ["actually can you update my name to Prateek", "Prateek"],
    ["change my name to Prateek please", "Prateek"],
    ["my name is actually Prateek", "Prateek"],
    ["it's actually Prateek", "Prateek"],
    ["correct the name to Prateek", "Prateek"],
    ["I go by Prateek", "Prateek"],
  ])("takes the new name from %p", (correction, expected) => {
    const notes = buildCallNotes(["hi my name is Akash", "a k a s h", correction]);
    expect(notes.statedName).toBe(expected);
    // The old SPELLING must not outrank the newer spoken name.
    expect(notes.spelledName).toBeNull();
    expect(formatCallNotes(notes)).toContain("Prateek");
    expect(formatCallNotes(notes)).not.toContain("Akash");
  });

  it("still lets a spelling of the name just given win, which is the normal case", () => {
    const notes = buildCallNotes(["my name is Akash", "a k a s h"]);
    expect(notes.spelledName).toEqual(["akash"]);
    expect(formatCallNotes(notes)).toContain("A-K-A-S-H");
  });

  it("uses the newest name even when the caller spells the correction too", () => {
    const notes = buildCallNotes([
      "my name is Akash",
      "a k a s h",
      "update my name to Prateek",
      "p r a t e e k",
    ]);
    expect(notes.spelledName).toEqual(["prateek"]);
    expect(formatCallNotes(notes)).toContain("P-R-A-T-E-E-K");
  });
});

/**
 * 2026-10-22, from running the last 100 real calls' transcripts back through
 * this parser. Grace was recorded saying, verbatim:
 *   'Okay, just to confirm, your name is spelled "O-K-A-Y, T-H-A-T
 *    apostrophe S, R-I-G-H-T"? What's ...'
 *   'Your name is S-S-K, spelled as you said it.'
 * Conversational filler and speech-recognition debris were being written to
 * the customer record as names.
 */
describe("filler and debris are not names", () => {
  const asNameAnswer = (answer: string) =>
    buildCallNotes(
      [answer],
      [
        { speaker: "agent", text: "Can I get your name?" },
        { speaker: "caller", text: answer },
      ],
    );

  it.each([
    ["okay that's right"],
    ["okay"],
    ["yeah sure"],
    ["go ahead"],
    ["that's right"],
    ["hi there"],
    ["hello how are you"],
    ["no problem"],
    ["it's fine"],
    // Three stray letters with nothing to corroborate them.
    ["s s k"],
  ])("takes no name from %p", (answer) => {
    const notes = asNameAnswer(answer);
    expect(notes.statedName).toBeNull();
    expect(notes.spelledName).toBeNull();
  });

  it.each([
    ["Tom"],
    ["Tom Harris"],
    ["Siobhan"],
    ["Jose Hernandez"],
    ["Zayn"],
    ["Kwame"],
    ["Luz"],
    ["Guadalupe"],
  ])("still accepts the real name %p", (answer) => {
    const notes = asNameAnswer(answer);
    expect(notes.statedName ?? notes.spelledName?.join(" ")).not.toBeNull();
  });

  it("keeps a three-letter spelling the caller corroborated", () => {
    expect(buildCallNotes(["my name is Bob", "b o b"]).spelledName).toEqual(["bob"]);
    expect(
      buildCallNotes(
        ["b o b"],
        [
          { speaker: "agent", text: "Could you spell that for me?" },
          { speaker: "caller", text: "b o b" },
        ],
      ).spelledName,
    ).toEqual(["bob"]);
  });
});

/** 2026-10-23 tester call: "My name is Yash", heard as "Josh" every time it was said. */
describe("nameDisputeNote", () => {
  it.each([
    ["no, that's not my name"],
    ["you got my name wrong"],
    ["wrong name"],
    ["my name isn't josh"],
    ["no not Josh"],
    ["it's not josh it's yash"],
  ])("asks for a spelling when the caller says %p", (said) => {
    expect(nameDisputeNote([said], "Josh")).toContain("spell their first name letter by letter");
  });

  it.each([
    // Ordinary replies that happen to contain "not".
    ["no, not right now"],
    ["it's not leaking anymore"],
    ["no that's not the address"],
    ["no"],
    // Already the fix: the caller is spelling it.
    ["no it's y a s h"],
  ])("stays quiet for %p", (said) => {
    expect(nameDisputeNote([said], "Josh")).toBeNull();
  });

  it("only looks at the latest thing the caller said", () => {
    expect(nameDisputeNote(["that's not my name", "y a s h"], "Yash")).toBeNull();
  });
});

/**
 * 2026-10-23, the client's last three calls, replayed line for line. Each
 * case is what the caller actually said, in the pieces speech recognition
 * cut it into, with Grace's replies where they fell.
 */
describe("names from the 2026-10-23 client calls", () => {
  const at = "";
  function said(...lines: Array<[string, string]>) {
    const turns = lines.map(([speaker, text], turnIndex) => ({
      turnIndex,
      speaker,
      text,
      confidence: null,
      offsetMs: 0,
      at,
    }));
    const callerTexts = lines.filter(([who]) => who === "caller").map(([, text]) => text);
    return buildCallNotes(callerTexts, turns);
  }

  it("emergency call: 'i'm actually also smelling' is not the name 'Also'", () => {
    const notes = said(
      ["caller", "hi guys actually my water heater just"],
      [
        "caller",
        "died overnight and there is no hot water at all and i'm actually also smelling something like a burning smell near it so i'm actually a little worried",
      ],
    );
    expect(notes.statedName).toBeNull();
    expect(notes.spelledName).toBeNull();
  });

  it("'hello it's yours' is not the name 'Yours'", () => {
    expect(
      said(["agent", "What's your name?"], ["caller", "hello it's yours"]).statedName,
    ).toBeNull();
  });

  it("a last name said after a pause is kept: 'my name is trevor' / 'lindquist'", () => {
    const notes = said(
      ["agent", "Could I get your name, please?"],
      ["caller", "yes my name is trevor"],
      ["caller", "lindquist"],
    );
    expect(notes.statedName).toBe("Trevor Lindquist");
  });

  it("'the last name is lindquist' sets the LAST name, never the first", () => {
    const notes = said(["caller", "it's trevor and the last name is lindquist"]);
    expect(notes.statedName).toBe("Trevor Lindquist");
  });

  it("first and last name spelled separately keeps both, each in its own place", () => {
    const notes = said(
      ["agent", "What's your name?"],
      ["caller", "yes my name is siobhan"],
      ["caller", "okonkwo"],
      ["agent", "Just to confirm, that's Siobhan, spelled S-I-O-B-H-A-N?"],
      ["caller", "s i p h a n"],
      ["agent", "Got it, that's Siphan, S-I-P-H-A-N. What's the address?"],
      ["caller", "o k o n k w o"],
    );
    expect(notes.spelledName).toEqual(["siphan", "okonkwo"]);
  });

  it("a spelling cut in half by Grace talking is read as one word, not 'Qvist'", () => {
    const notes = said(
      ["agent", "You're all set, Trevor. Take care!"],
      [
        "caller",
        "also can you update my full name well it's trevor and the last name is lindquist l i n d",
      ],
      [
        "agent",
        "Your full name is Trevor Lindquist, spelled L-I-N-D, L-I-N-D-Q-U-I-S-T. Now, is there",
      ],
      ["caller", "q v i s t"],
    );
    expect(notes.spelledName).toEqual(["trevor", "lindqvist"]);
  });

  it("the caller's final correction, said in three pieces, gives first and last name", () => {
    const notes = said(
      ["agent", "Your name is Qvist, spelled Q-V-I-S-T. Now, can I get your street address?"],
      ["caller", "well you got my name wrong my name is trevor"],
      ["caller", "the first name is trevor t r e v o r the last name is lindquist l i n d"],
      ["caller", "q v i s t"],
    );
    expect(notes.spelledName).toEqual(["trevor", "lindqvist"]);
  });

  it("still lets a later spoken name replace an earlier one", () => {
    const notes = said(
      ["caller", "my name is akash kumar"],
      ["agent", "Thanks."],
      ["caller", "update my name to prateek"],
    );
    expect(notes.statedName).toBe("Prateek");
  });

  it("a last name given out loud after Grace asks for it is kept", () => {
    const notes = said(
      ["caller", "my name is tom"],
      ["agent", "And your last name?"],
      ["caller", "harris"],
    );
    expect(notes.statedName).toBe("Tom Harris");
  });

  it("an answer to the last-name question that is not a name changes nothing", () => {
    const notes = said(
      ["caller", "my name is tom"],
      ["agent", "And your last name?"],
      ["caller", "why do you need that"],
    );
    expect(notes.statedName).toBe("Tom");
  });

  it("a finished spelling is never glued to the next answer", () => {
    const notes = said(
      ["caller", "my name is tom, t o m"],
      ["agent", "And your last name?"],
      ["caller", "h a r r i s"],
    );
    expect(notes.spelledName).toEqual(["tom", "harris"]);
  });
});

/** 2026-10-23 client call: a name update was followed by "can I get your street address?". */
describe("nameUpdateNote", () => {
  it.each([
    ["also can you update my full name well it's trevor and the last name is lindquist l i n d"],
    ["can you change my last name"],
    ["please correct the name"],
    ["my name should be spelled differently"],
  ])("keeps the turn to the name for %p", (said) => {
    expect(nameUpdateNote([said])).toContain("Do NOT ask again for the address");
  });

  it.each([
    ["can you fix the leak, my name is bob"],
    ["my name is trevor"],
    ["can you update me on the time"],
  ])("stays quiet for %p", (said) => {
    expect(nameUpdateNote([said])).toBeNull();
  });
});

/** 2026-10-23, the four client calls after 08:39, replayed line for line. */
describe("names from the 2026-10-23 afternoon calls", () => {
  function said(...lines: Array<[string, string]>) {
    const turns = lines.map(([speaker, text], turnIndex) => ({
      turnIndex,
      speaker,
      text,
      confidence: null,
      offsetMs: 0,
      at: "",
    }));
    return buildCallNotes(
      lines.filter(([who]) => who === "caller").map(([, text]) => text),
      turns,
    );
  }

  it("a stutter is not a last name: 'todd todd allen' is Todd Allen", () => {
    expect(said(["caller", "well my name is todd todd allen"]).statedName).toBe("Todd Allen");
  });

  it("a unit number is not a name: 'it's four twelve unit four twelve'", () => {
    const notes = said(
      ["caller", "hi my name is anya kessler"],
      ["agent", "Sure, go ahead. What's the rest of your address?"],
      ["caller", "yes it's four twelve unit four twelve seattle washington nine eight one two one"],
      ["agent", "You're all set."],
      ["caller", "oh i'll have you registered my name is four are you basically an idiot"],
    );
    expect(notes.statedName).toBe("Anya Kessler");
  });

  it("'i am unable to understand' is not the name Unable", () => {
    const notes = said(
      ["caller", "my name is barry allen"],
      ["agent", "Thanks, Barry."],
      ["caller", "nable to understand i am i am unable to understand"],
    );
    expect(notes.statedName).toBe("Barry Allen");
  });

  it("letters inside a sentence are not a spelled name: 'u r n a i u r n damas'", () => {
    const notes = said(
      ["caller", "my name is omar hadad"],
      ["agent", "Thanks, Omar."],
      ["caller", "u r n a i u r n damas"],
    );
    expect(notes.spelledName).toBeNull();
  });

  it("'double d' is two d's: 'o m a r h a double d a d' is Omar Haddad", () => {
    const notes = said(["caller", "my name is omar hadag"], ["caller", "o m a r h a double d a d"]);
    expect(notes.spelledName).toEqual(["omar", "haddad"]);
  });

  it("a name split by Grace being talked over is read as one: 'okay my name' / 'is barry allen'", () => {
    const notes = said(
      ["caller", "okay my name"],
      ["agent", "Yes, I'm here"],
      ["caller", "is barry allen and i'm calling just because that i have i guess a leak"],
    );
    expect(notes.statedName).toBe("Barry Allen");
  });

  it("still keeps the introductions people really use", () => {
    expect(said(["caller", "this is Tom at 4512 maple street"]).statedName).toBe("Tom");
    expect(said(["caller", "i'm tom and i have a leak"]).statedName).toBe("Tom");
    expect(said(["caller", "hi it's mable from the cafe"]).statedName).toBe("Mable");
  });
});

/** Found by replaying every call of the last ten days through the name code. */
describe("names from the ten-day replay", () => {
  function said(...lines: Array<[string, string]>) {
    const turns = lines.map(([speaker, text], turnIndex) => ({
      turnIndex,
      speaker,
      text,
      confidence: null,
      offsetMs: 0,
      at: "",
    }));
    return buildCallNotes(
      lines.filter(([who]) => who === "caller").map(([, text]) => text),
      turns,
    );
  }

  it("a house number after 'it's' is not a name (18 of 91 calls had one)", () => {
    expect(said(["caller", "it's eleven thirty three east pike street"]).statedName).toBeNull();
    expect(said(["caller", "yes it's sixty five"]).statedName).toBeNull();
  });

  it("'it's where is it' does not overwrite the name given earlier", () => {
    const notes = said(
      ["caller", "hi grace good evening my name is paul allen"],
      ["agent", "Is the water running right now?"],
      ["caller", "it's where is it well the reason is somewhat damp"],
    );
    expect(notes.statedName).toBe("Paul Allen");
  });

  it("'the state name is ford' is not the caller's name", () => {
    const notes = said(
      ["caller", "hi my name is joseph"],
      ["agent", "Can you please confirm the street name and house number?"],
      ["caller", "and the state name"],
      ["caller", "is ford l"],
    );
    expect(notes.statedName).toBe("Joseph");
  });

  it("'yes martha martha' is Martha", () => {
    expect(
      said(["agent", "Can I get your name, please?"], ["caller", "yes martha martha"]).statedName,
    ).toBe("Martha");
  });

  it("a spelling said twice is one word", () => {
    const notes = said(
      ["agent", "Could you spell that for me?"],
      ["caller", "yes it's r e n a t a"],
      ["caller", "r e n a t a, d u b o i s"],
    );
    expect(notes.spelledName).toEqual(["renata", "dubois"]);
  });

  it("'it's y a s h' is a spelling even when nobody asked for one", () => {
    expect(
      said(["agent", "Can you tell me the address?"], ["caller", "it's y a s h"]).spelledName,
    ).toEqual(["yash"]);
  });

  it("'it's spelled', 'it's wrong' and 'this is seattle' are not names", () => {
    expect(said(["caller", "it's spelled"]).statedName).toBeNull();
    expect(said(["caller", "it's wrong it's s k"]).statedName).toBeNull();
    expect(said(["caller", "this is seattle five eight street"]).statedName).toBeNull();
  });
});

/** 2026-10-23 client calls: addresses saved as "4 North Avenue" and "1748 and it s westlake avenue unit 4". */
describe("addresses from the 2026-10-23 afternoon calls", () => {
  it("reads 'one triple four' as 1444", () => {
    expect(
      buildCallNotes(["yes my address is one triple four north sixtieth street seattle"]).street,
    ).toBe("1444 north sixtieth street");
  });

  it("keeps the caller's joining words out of the street", () => {
    expect(
      buildCallNotes([
        "well the house number is one seven four eight and it's",
        "westlake avenue unit four",
      ]).street,
    ).toBe("1748 westlake avenue unit 4");
  });

  it("takes a unit given after the street", () => {
    expect(
      buildCallNotes([
        "well the house number is one seven four eight and it's",
        "westlake avenue unit four",
        "seattle washington",
        "yes it's four twelve unit four twelve seattle washington nine eight one two one",
      ]).street,
    ).toBe("1748 westlake avenue unit 412");
  });
});

/**
 * QA 2026-10-23: since the name nudge now defers to these notes, a false name
 * here would stop Grace ever asking for the real one. Found by replaying every
 * prefix of every call of the last ten days.
 */
describe("describing words after 'it's' or 'i'm' are never a name", () => {
  it.each([
    ["It's actively leaking."],
    ["it's constantly dripping"],
    ["it's steadily getting worse"],
    ["well it's an underground thing and it's somewhat wet"],
    ["if i'm unhappy do you care"],
    ["as long as it's upfront before anything starts"],
    ["hi this is grace at all phase plumbing"],
  ])("%p", (said) => {
    expect(buildCallNotes([said]).statedName).toBeNull();
  });

  it("still keeps names that end in -ly", () => {
    expect(buildCallNotes(["hi it's emily"]).statedName).toBe("Emily");
    expect(buildCallNotes(["this is kelly and my sink is clogged"]).statedName).toBe("Kelly");
    expect(buildCallNotes(["my name is kimberly"]).statedName).toBe("Kimberly");
  });
});
