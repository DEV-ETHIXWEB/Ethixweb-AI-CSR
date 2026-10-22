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

/**
 * 2026-10-22 tester call: the address readback came out fast and garbled,
 * "and when asked what, it moved on to next question like what's the best
 * phone number and all."
 *
 * A caller who did not hear needs the same words again, not the next
 * question. Nothing in the prompt or the code covered this, so the model
 * treated "what?" as any other turn and carried on with the intake -- which
 * leaves the caller never having heard the one thing they were being asked
 * to confirm.
 *
 * Two shapes: a short utterance that is only a request to repeat, and an
 * explicit one at any length. The short-utterance limit is what keeps
 * "what time do you open" and "what do you need from me" out of it -- those
 * are real questions, and answering them with a repeat would be its own bug.
 */
// "hello" is deliberately NOT here. A caller saying "hello?" mid-call has
// its own established answer ("Yes, I'm here", prompt # LISTEN BEFORE YOU
// ASK) and taking that over with a repeat would be a change to behaviour
// nobody reported as broken.
const REPEAT_WORDS =
  /^\s*(what|what'?s that|huh|sorry|pardon|excuse me|come again|again|say (that )?again)\b[\s?.!]*$/i;
const REPEAT_PHRASES =
  /\b(say that again|repeat that|repeat it|come again|didn'?t (quite )?(catch|hear|get) (that|you)|could'?nt hear|can'?t hear you|couldn'?t hear you|you broke up|broke up|one more time|what did you say|say it again)\b/i;
const REPEAT_MAX_WORDS = 5;

export function isRepeatRequest(callerTranscript: string): boolean {
  const text = callerTranscript.trim();
  if (text.length === 0) {
    return false;
  }
  if (REPEAT_PHRASES.test(text)) {
    return true;
  }
  return text.split(/\s+/).length <= REPEAT_MAX_WORDS && REPEAT_WORDS.test(text);
}

export const REPEAT_NOTE =
  "[The caller did not hear you. Your whole reply: say your LAST sentence again, " +
  "the same words, nothing added and nothing new. If it was an address, a ZIP or a phone " +
  "number, say the digits one at a time. Do not move on to the next question, and do not " +
  "apologise at length.]";

/**
 * A listener noise, not a turn: "yeah", "uh-huh", "mm-hmm", "okay" and
 * nothing else. voice-runtime already treats these as not taking the floor
 * (its own backchannel-detector, which gates barge-in), and it allows an
 * empty reply to one rather than filling the gap.
 *
 * Needed here because of the never-silent fallback in handle-turn: without
 * this, a model that correctly answers a backchannel with nothing would get
 * a spoken line put in its mouth, and Grace would talk at a caller who was
 * only saying "mm-hmm, go on". The word list matches voice-runtime's own
 * deliberately short one; the WHOLE utterance must be backchannel, so a real
 * short objection ("no", "wait") and anything that merely starts with one
 * ("yeah, but hold on") is a genuine turn.
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

export function isPureBackchannel(callerTranscript: string): boolean {
  const words = callerTranscript
    .trim()
    .split(/\s+/)
    .map((word) => word.toLowerCase().replace(/[^a-z0-9]/g, ""))
    .filter((word) => word.length > 0);
  return words.length > 0 && words.every((word) => BACKCHANNEL_WORDS.has(word));
}

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
  "[The caller's words trail off unfinished; they are still talking. Say nothing and wait for them to continue.]";
