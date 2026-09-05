/**
 * Distinguishes a backchannel ("yeah," "uh-huh," "okay" — a listener
 * signaling "I'm following, keep going" without meaning to take the
 * floor) from a genuine attempt to interrupt. Used ONLY to gate
 * CallSessionOrchestrator's EXISTING barge-in confirmation mechanism
 * (handleSpeechStarted's pending-confirmation timer, confirmed by
 * onInterimSpeech) — this is deliberately not a second, competing
 * interruption system: it adds one classification step to the one
 * mechanism that already exists, nothing more.
 *
 * Deliberately conservative: the WHOLE trimmed transcript must consist
 * only of known backchannel words for this to return true. A phrase that
 * merely STARTS with one ("Yes, but wait" / "Right, that's not what I
 * meant") is real speech and must interrupt — this is exactly the
 * distinction the mission's own worked example draws ("Yes, but..." must
 * take the floor). A short list, not a trained classifier — the mission
 * names five exact examples ("uh huh," "yeah," "right," "okay,"
 * "mm-hmm"); this adds only their closest, unambiguous spelling variants,
 * not a broad "sounds agreeable" heuristic that risks swallowing a real,
 * short objection like "no" or "wait."
 */
const BACKCHANNEL_WORDS = new Set([
  "yeah",
  "yep",
  "yup",
  "ok",
  "okay",
  "right",
  "sure",
  "alright",
  // "mm-hmm"/"uh-huh" can arrive from Deepgram as one hyphenated token OR
  // as two separate space-separated words — both tokenizations are
  // covered: the merged forms here, and their individual parts ("mm",
  // "hmm", "uh", "huh") below.
  "mhm",
  "mmhmm",
  "uhhuh",
  "mm",
  "hmm",
  "hm",
  "huh",
  "uh",
  "oh",
]);

/** Collapses to letters/digits only so "uh-huh," "uh huh," "Mm-Hmm!" and similar spacing/punctuation/case variants all normalize to the same lookup key — the caller's actual utterance boundaries came from Deepgram's own word segmentation, not this function's, so being punctuation/spacing-agnostic here is what makes the short word list above actually match real transcripts. */
function normalizeToken(token: string): string {
  return token.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function isPureBackchannel(transcript: string): boolean {
  const trimmed = transcript.trim();
  if (trimmed.length === 0) {
    return false;
  }
  const words = trimmed
    .split(/\s+/)
    .map(normalizeToken)
    .filter((word) => word.length > 0);
  if (words.length === 0) {
    return false;
  }
  return words.every((word) => BACKCHANNEL_WORDS.has(word));
}
