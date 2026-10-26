import { buildCallNotes } from "./call-notes";
import { nameAndAddressNotReadBackError, spokenPhoneDigits } from "./save-readiness";

// 2026-10-26, the client's Full-Mix test scripts: callers give the name, the
// number and the address in one breath. The number's last digits and the
// house number ran together ("206-441-2298. 2719 Alki"), so Grace read back
// "4-1-2-2-9-8-2-7-1-9" as the caller's number and never found the street.
describe("name, number and address in one breath", () => {
  it.each([
    [
      "Lydia Fenwick, F E N W I C K. 206-441-2298. 2719 Alki Avenue Southwest, Seattle, Washington, 98116.",
      "2064412298",
      "2719",
    ],
    [
      "Desmond Okafor-Bright, O K A F O R, dash, B R I G H T. 206-350-9981. 4512 Fauntleroy Way Southwest, Seattle, Washington, 98116.",
      "2063509981",
      "4512",
    ],
    [
      "Quentin Osagiede, O S A G I E D E. 206-771-4420. 3390 Northwest 65th Street, Seattle, Washington, 98117.",
      "2067714420",
      "3390",
    ],
    [
      "Henrietta Boyevsky, B O Y E V S K Y. 206-390-6642. 1821 Queen Anne Avenue North, Seattle, Washington, 98109.",
      "2063906642",
      "1821",
    ],
  ])("%p", (said, phone, house) => {
    expect(spokenPhoneDigits([said])).toBe(phone);
    expect(buildCallNotes([said]).street ?? "").toMatch(new RegExp(`^${house} `));
  });
});

// Same scripts: "Lydia Fenwick, F E N W I C K." spells the LAST name only.
// The notes called "Fenwick" a first name with no last name, so Grace said
// "Got it, Fenwick" and the first name was lost.
describe("a full name followed by the spelling of the last name", () => {
  const asked = { speaker: "agent", text: "Can I get your name, please?" };
  it.each([
    ["Lydia Fenwick, F E N W I C K. 206-441-2298.", "Lydia Fenwick", ["lydia", "fenwick"]],
    [
      "Priscilla Amadasun, A M A D A S U N. The job was at 7701 15th Avenue Northwest.",
      "Priscilla Amadasun",
      ["priscilla", "amadasun"],
    ],
    [
      "Desmond Okafor-Bright, O K A F O R, dash, B R I G H T. 206-350-9981.",
      "Desmond Okafor-Bright",
      ["desmond", "okafor-bright"],
    ],
  ])("%p", (said, name, spelled) => {
    const notes = buildCallNotes([said], [asked, { speaker: "caller", text: said }]);
    expect(notes.statedName).toBe(name);
    expect(notes.spelledName).toEqual(spelled);
  });

  it("works without a name question too", () => {
    const said =
      "Sure, go ahead and take my info. Bartholomew Nkemdirim, N K E M D I R I M. 206-662-7730.";
    const notes = buildCallNotes(
      [said],
      [
        { speaker: "agent", text: "Do you have a specific service in mind?" },
        { speaker: "caller", text: said },
      ],
    );
    expect(notes.statedName).toBe("Bartholomew Nkemdirim");
    expect(notes.spelledName).toEqual(["bartholomew", "nkemdirim"]);
  });
});

// Script 10: "Her name is Agnes Prempeh" is the mother, not the caller.
describe("someone else's name is not the caller's", () => {
  it("keeps the caller's own name", () => {
    const said =
      "My name is Nathaniel Prempeh, P R E M P E H, my number's 206-220-7743, but my mother will be the one home. Her name is Agnes Prempeh, and her number is 206-220-7799, that's a separate line in the house.";
    const notes = buildCallNotes(
      [said],
      [
        { speaker: "agent", text: "What's your name?" },
        { speaker: "caller", text: said },
      ],
    );
    expect(notes.statedName).toBe("Nathaniel Prempeh");
    expect(notes.spelledName).toEqual(["nathaniel", "prempeh"]);
    expect(notes.phone).toBe("2062207743");
  });
});

// From a recorded call: asked "What's your name?", the caller was heard as
// "his name is trevor". With no name of their own given first, it is theirs.
it("'his name is' answering the name question is still the caller's name", () => {
  const notes = buildCallNotes(
    ["his name is trevor"],
    [
      { speaker: "agent", text: "What's your name?" },
      { speaker: "caller", text: "his name is trevor" },
    ],
  );
  expect(notes.statedName).toBe("Trevor");
});

// A save tried before anything was read back hands over the one combined
// first question, so the name and the address are confirmed together.
describe("nameAndAddressNotReadBackError", () => {
  const name = { spelled: ["quentin", "osagiede"], stated: "Quentin Osagiede" };
  const address = { street: "3390 northwest 65th street", zip: "98117" };

  it("hands over the combined line", () => {
    expect(nameAndAddressNotReadBackError(name, address, [])?.detail).toContain(
      '"Let me make sure I have it right: Quentin, Q-U-E-N-T-I-N, Osagiede, O-S-A-G-I-E-D-E, at 3-3-9-oh northwest 65th street, ZIP 9-8-1-1-7. Is that right?"',
    );
  });

  it("is null once both were read back", () => {
    expect(
      nameAndAddressNotReadBackError(name, address, [
        "Let me make sure I have it right: Quentin, Q-U-E-N-T-I-N, at 3-3-9-oh northwest 65th street. Is that right?",
      ]),
    ).toBeNull();
  });
});
