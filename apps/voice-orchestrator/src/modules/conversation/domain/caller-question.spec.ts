import { answerFirst, callerAskedAQuestion } from "./caller-question";

/**
 * 2026-10-22 tester call: "when asked 'can someone come out today?' it
 * skipped the question and followed the normal routine call." A transcript
 * never carries a question mark (Deepgram is not asked for punctuation), so
 * this reads the words.
 */
describe("callerAskedAQuestion", () => {
  it.each([
    "can someone come out today",
    "can you come out today",
    "how much does it cost",
    "how soon can someone get here",
    "do you charge for coming out",
    "is there a fee for the visit",
    "what time do you open",
    "any chance someone's free this afternoon",
    "will someone call me back",
    "it's 4512 maple street, and can someone come out today",
    "am I speaking to a real person",
    "my sink is leaking, do you do that kind of work",
  ])("hears the question in %p", (said) => {
    expect(callerAskedAQuestion(said)).toBe(true);
  });

  it.each([
    "my kitchen sink is leaking",
    "it's 4512 maple street",
    "yes that's right",
    "no, it's my home",
    "I don't know what happened",
    "that's where it's leaking from",
    "my name is akash",
    "as soon as possible",
    "",
  ])("does not hear a question in %p", (said) => {
    expect(callerAskedAQuestion(said)).toBe(false);
  });

  it("still hears a question mark when one is there", () => {
    expect(callerAskedAQuestion("are you there?")).toBe(true);
  });
});

describe("answerFirst", () => {
  it("adds the clause inside the note, so the turn still carries exactly one", () => {
    const note = answerFirst("[The caller just gave their address. Ask nothing else.]");
    expect(note.match(/\[/g)).toHaveLength(1);
    expect(note).toContain("answer that in one short sentence first");
    expect(note).not.toContain("Ask nothing else");
    expect(note.endsWith("]")).toBe(true);
  });
});
