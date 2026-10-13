import { addressReadbackNote, buildCallNotes, formatCallNotes } from "./call-notes";

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

describe("addressReadbackNote (QA 2026-10-13: a volunteered address was ignored)", () => {
  it("asks for a read-back when the caller just gave a full address", () => {
    const note = addressReadbackNote(
      ["My name is Pat Lee.", "It's 1912 9th Avenue West, Seattle, 98119."],
      ["Is it leaking right now?"],
    );
    expect(note).toContain("read it back once");
    expect(note).toContain("9-8-1-1-9");
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
});
