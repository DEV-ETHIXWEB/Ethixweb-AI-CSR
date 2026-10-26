/**
 * 2026-10-26, Yash's test calls. An elderly caller ("my son usually handles
 * this") started giving his address and asked "what was your name again",
 * and Grace said "I still need your name first". Another caller would not
 * give a name, and Grace asked for it three more times. Each of these is
 * read here so the turn's note can say what to do.
 */

const NAME_QUESTION =
  /\b(your name|who am i speaking|what'?s your name|can i (get|have|grab) your name|and your name|share your name|your first and last name)\b/i;

const DECLINES =
  /\b(?:don'?t|do not|won'?t|will not|not going to|rather not|prefer not to|no need to)\s+(?:want to\s+|wanna\s+)?(?:give|share|tell|say|provide)\b|\bnot giving\b|\bno name\b|\bwhy do you need my name\b|\brather not\b/i;

/** The caller turned down giving a name, in answer to Grace asking for it, at any point in the call. */
export function declinedTheirName(
  turns: ReadonlyArray<{ speaker: string; text: string }>,
): boolean {
  for (let i = 1; i < turns.length; i += 1) {
    const before = turns[i - 1]!;
    const now = turns[i]!;
    if (
      before.speaker === "agent" &&
      now.speaker === "caller" &&
      NAME_QUESTION.test(before.text) &&
      DECLINES.test(now.text)
    ) {
      return true;
    }
  }
  return false;
}

/** "what was your name again", "who am I speaking with": a question about Grace. */
export function asksGracesName(text: string): boolean {
  return /\bwhat(?:'s| is| was)\s+your name\b|\bwho (?:am i|are we) (?:speaking|talking) (?:to|with)\b|\bwho is this\b/i.test(
    text,
  );
}

/** The caller is starting to give the service address now. */
export function offersAddress(text: string): boolean {
  return /\b(?:my|the) address is\b|\bi live (?:at|on)\b|\bthe house is at\b/i.test(text);
}

/**
 * 2026-10-26, Yash's test call: "you charged me four hundred bucks ... I
 * want my money back and I want to talk to the owner" got only "Sure,
 * connecting you now". The transfer stays immediate; the line says sorry
 * for what went wrong first.
 */
const WANTS_A_PERSON =
  /\b(?:talk|speak) (?:to|with) (?:the |a |an |your |someone |somebody )?(?:owner|manager|person|human|supervisor|boss|someone|somebody|real person)\b|\breal person\b/i;
const UPSET =
  /\b(?:charged|refund|money back|ridiculous|overcharg\w*|unacceptable|angry|upset|furious|scam|ripped off|nobody (?:came|showed)|no one (?:came|showed))\b/i;

export function upsetAndWantsAPerson(text: string): boolean {
  return WANTS_A_PERSON.test(text) && UPSET.test(text);
}
