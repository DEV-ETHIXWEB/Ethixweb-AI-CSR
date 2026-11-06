/**
 * "I'd really rather not pay again for the same problem if it's something
 * that should've been fixed right the first time."
 *
 * Found 2026-11-06 on the final real-model sweep (round4-03). Grace
 * answered "That makes total sense. Let me confirm the callback number: is
 * 2-oh-6..." She acknowledged it and then went straight back to
 * form-filling, which reads as being handled rather than heard.
 *
 * This is a narrow case but a sharp one. The caller is not asking a
 * question, so nothing in the answer-the-question machinery fires; they are
 * stating a grievance about money on work the business already did. Left
 * alone it is the sentence that decides whether they call back or tell
 * someone the company tried to charge them twice.
 *
 * What Grace must NOT do is settle it. Whether a particular job falls under
 * the warranty is the manager's call (see output-guard's COVERAGE_CLAIM),
 * and promising "you won't be charged" here would be the same unauthorised
 * promise in a warmer voice. She acknowledges it, says the team will look
 * at it, and carries on.
 */

/**
 * A caller objecting to paying twice for work already done. Requires BOTH a
 * money word and a repeat-work word: "I don't want to pay for a new water
 * heater" is an ordinary price worry on new work and must not match.
 */
const PAYING_AGAIN =
  /\b(?:pay(?:ing|s)?|paid|charge[ds]?|charging|bill(?:ed)?|cost)\b[^.?!]{0,50}\b(?:again|twice|second time|same (?:problem|issue|thing|spot|leak|repair)|already (?:paid|fixed))\b|\b(?:again|twice|same (?:problem|issue|thing))\b[^.?!]{0,50}\b(?:pay(?:ing|s)?|paid|charge[ds]?|charging|bill(?:ed)?|out of pocket)\b|\bshould(?:'?ve| have) been (?:fixed|done)\b[^.?!]{0,30}\b(?:first time|properly|right)\b|\bfixed right the first time\b/i;

/** True when the caller is objecting to paying twice for the same work. */
export function objectsToPayingTwice(transcript: string): boolean {
  return PAYING_AGAIN.test(transcript);
}

/**
 * Deliberately does not settle the money question, because Grace cannot.
 * It names the one true next step, which is also what the caller is really
 * asking for: that a person will actually look at it.
 */
export const PAYING_TWICE_NOTE =
  "[they have just said they do not want to pay again for work already done. " +
  "Answer THAT before anything else: acknowledge it in one short sentence, then " +
  "say the team will look at what happened and sort it out with them. Do NOT ask " +
  "for a detail or move on to logistics in the same breath. Never say they will " +
  "not be charged, and never say the work is or is not covered: only the manager " +
  "decides that.]";
