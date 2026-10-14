/**
 * Client feedback (Prateek, 2026-10-09): "she asked me for some details, and
 * when I gave them, she confirmed the details and then went silent, after
 * some time she started saying 'I am here'".
 *
 * The shape behind it: the model's whole reply is an acknowledgment or a
 * read-back with no question ("Perfect, I have 1 2 3 Main Street, 3 0 3 0 1."),
 * and it calls no tool. Nothing hands the turn back to the caller, so both
 * sides wait, and fifteen seconds later voice-runtime's silence check-in
 * fills the gap with "Take your time. I'm still here." The prompt's "one
 * question OR one statement" shape allows exactly this, and the earlier fix
 * for call 9ecc6846 only covered the case where a backstop tool had run.
 *
 * This decides whether a finished reply left the caller with nothing to
 * answer. Over-triggering costs one extra short question; under-triggering
 * is the dead air the client heard, so it errs toward continuing, but never
 * after a goodbye and never when the reply already invites the caller to
 * talk without a question mark ("go ahead", "please spell that").
 */

const ASKS_OR_INVITES =
  /\?|\b(go ahead|take your time|no rush|whenever you'?re ready|i'?m listening|let me know|tell me (more|about|what|where|when|how))\b|\b(can|could|would|will) you\b|(^|[.!]\s*)(please )?(spell|tell|give|say|repeat|confirm|describe)\b|\bplease (spell|tell|give|say|repeat|confirm|describe)\b/i;

const CLOSING_LINE =
  /\b(bye|goodbye|good bye|take care|talk soon|have a (good|great|nice|wonderful) (day|night|one|evening|weekend)|thanks? (you )?for calling|good luck|hope you get (it|that) sorted)\b/i;

/** The caller asked Grace to wait ("hold on, let me find the zip"): the reply should only agree, never add a question. */
export function isHoldRequest(callerTranscript: string): boolean {
  return /\b(hold on|hang on|one (sec|second|moment|minute)|just a (sec|second|moment|minute)|give me a (sec|second|moment|minute)|let me (check|find|look|get|grab)|wait a (sec|second|moment|minute))\b/i.test(
    callerTranscript,
  );
}

export function isStalledReply(responseText: string): boolean {
  const text = responseText.trim();
  if (text.length === 0) {
    // An empty reply is a deliberate silence (a fragment or backchannel the
    // runtime is holding), not a stall.
    return false;
  }
  return !ASKS_OR_INVITES.test(text) && !CLOSING_LINE.test(text);
}

export const KEEP_CALL_MOVING_NOTE =
  "[System note: your reply only acknowledged and did not move the call forward, so the caller " +
  "is now waiting in silence. Do not repeat or re-confirm what you just said, and do not ask again " +
  "for anything the caller already gave you. In one short sentence, ask the next thing you need. " +
  "If you already have everything, ask whether there is anything else you can help with.]";

/**
 * The caller's words stop mid-sentence ("so let me check on", "my address
 * is"). voice-runtime already holds these for a few seconds and merges them
 * with what follows; this is the second line of defence for when one still
 * arrives as a whole turn. QA 2026-10-13: "Go ahead, what would you like to
 * check on?" spoken over a caller who was still talking.
 */
// Only endings that cannot finish a sentence. "is", "on", "so", "with" and
// "about" are left out on purpose: "yes it is", "turn it on", "I think so",
// "that's what I'm dealing with" are complete answers, and treating them as
// unfinished would leave Grace saying only "Mm-hm." and stalling the call.
// "from" is left out for the same reason, found 2026-10-14: "I don't know
// where from." is a complete answer, and with the whole-reply priority this
// note now has, a false positive here silences every other note on the
// turn too (the name-ask, call-notes, everything) — not just itself.
const TRAILING_WORD =
  /(\b(my|the|a|an|and|but|to|um|uh|your|our)|\b(check|look|work) on|\b(address|name|number|zip|zip code|street) is)[.,]?\s*$/i;

export function trailsOff(callerTranscript: string): boolean {
  const text = callerTranscript.trim();
  // A spelled name ends in single letters ("s u m a l i a"); its last "a" is a
  // letter, not the article. 2026-10-14: treating it as unfinished made Grace
  // answer a spelled name with only "Mm-hm." and then "I'm still here".
  if (/(\b[a-z]\b[\s,.-]*){2,}$/i.test(text)) {
    return false;
  }
  return TRAILING_WORD.test(text);
}

export const TRAILING_FRAGMENT_NOTE =
  '[The caller\'s words trail off unfinished; they are still talking. Your whole reply is "Mm-hm." and nothing else.]';
