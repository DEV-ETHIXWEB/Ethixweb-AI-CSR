/**
 * "I was told someone would call me back. Nobody did."
 *
 * This is the one moment on the line where the caller has already been let
 * down by the business before Grace says a word, and it is the call most
 * likely to end in a bad review. Real-model QA (round5-05) showed the
 * apology arriving only sometimes: on some runs Grace went straight into
 * taking details as though nothing had happened. Leaving the hardest
 * emotional beat of the call to sampling variance is the wrong trade, so
 * it is a deterministic note like the other beats that had to be reliable.
 *
 * What the wording is doing, and why:
 *
 * - **Own it in one sentence, first.** Before any question. A caller who
 *   has to repeat their complaint before being acknowledged gets angrier,
 *   not calmer.
 * - **No excuses and no blame.** Not the technician, not the office, not
 *   "the system". An explanation sounds like a defence and invites an
 *   argument the caller cannot win and Grace cannot settle.
 * - **Apologise once.** Repeated apologies read as hollow and eat the
 *   seconds the caller wants spent fixing it. The note says so explicitly
 *   because the model's instinct is to keep saying sorry.
 * - **Never promise it will happen this time.** Grace cannot make anyone
 *   call. The scenario's own check forbids "I promise" and "guaranteed",
 *   and a second broken promise is worse than the first.
 * - **Give something concrete instead.** Flagging the request as a repeat
 *   call is a real, true thing Grace is actually doing, which is what a
 *   caller asking "how do I know it'll happen this time?" is really after.
 */

/**
 * A complaint that a promised call never came. Deliberately narrow: it must
 * be a report about the PAST, never a request for a call in the future
 * ("can you call me back?") and never a question about one ("will someone
 * call me back?"), both of which are ordinary and must not trigger an
 * apology for something that has not happened.
 */
const MISSED_CALLBACK =
  /\b(?:(?:no-?\s?one|nobody|noone)\s+(?:ever\s+)?(?:called|rang|phoned|got back|reached out|has called|had called)|never\s+(?:called|rang|phoned|heard)(?:\s+(?:me|us))?(?:\s+back)?|didn'?t\s+(?:call|ring|phone|get)(?:\s+(?:me|us))?\s+back|did not\s+(?:call|ring)(?:\s+(?:me|us))?\s+back|still\s+(?:haven'?t|have not|hasn'?t|has not)\s+heard(?:\s+back)?|no\s+(?:call|callback|call\s?back)\s+(?:ever\s+)?came|waiting\s+(?:on|for)\s+a\s+call(?:\s?back)?\s+(?:since|for|from)|calling\s+(?:back\s+)?for\s+the\s+(?:second|third|2nd|3rd)\s+time|(?:second|third|2nd|3rd)\s+time\s+(?:i'?m\s+|i\s+have\s+|i'?ve\s+)?(?:calling|called|ringing|rung)|following\s+up\s+myself)\b/i;

/** A request or a question about a FUTURE call, which this is not about. */
const WANTS_A_CALL =
  /\b(?:can|could|would|will|should)\s+(?:you|someone|somebody|the team|anyone)\b[^.?!]{0,30}\bcall\b|\bcall me back\b\s*\?|\bplease call\b/i;

/**
 * The elliptical form, which is how people actually say it: "I was told
 * someone would call me back. Nobody did." The second sentence carries no
 * verb of its own, so the patterns above cannot see it; it only means what
 * it means next to the mention of a call. Both halves are required.
 */
const PROMISED_A_CALL =
  /\b(?:call(?:ed)?\s+(?:me|us)\s+back|call\s?back|calling\s+(?:me|us)\s+back|get\s+back\s+to\s+(?:me|us)|hear\s+back|someone\s+would\s+call)\b/i;
const NOBODY_DID = /\b(?:nobody|no-?\s?one|noone)\s+(?:did|has|ever\s+did|didn'?t)\b/i;

/** True when the caller is reporting that a promised call never arrived. */
export function reportsMissedCallback(transcript: string): boolean {
  if (PROMISED_A_CALL.test(transcript) && NOBODY_DID.test(transcript)) {
    return true;
  }
  if (!MISSED_CALLBACK.test(transcript)) {
    return false;
  }
  // "nobody called me back, can you have someone call me today?" is still a
  // complaint; only an utterance that is ONLY a forward-looking request is
  // excluded, so the future-request pattern has to win outright.
  return !(WANTS_A_CALL.test(transcript) && !MISSED_CALLBACK.test(transcript));
}

/**
 * Four openers rather than one. The same sentence on every such call makes
 * Grace a recording, which is the specific thing the client complained
 * about, and these calls are exactly the ones a caller repeats to other
 * people. Chosen by call id so it is stable for the whole of one call and
 * differs between calls, never random per turn.
 */
const MISSED_CALLBACK_OPENERS = [
  "I'm sorry, that call should have come and it didn't.",
  "I'm sorry you've had to chase us on this.",
  "I'm sorry, you shouldn't have had to call again.",
  "I'm sorry, that one got missed.",
] as const;

function openerFor(callId: string): string {
  let sum = 0;
  for (const character of callId) {
    sum = (sum + character.charCodeAt(0)) % 100000;
  }
  return MISSED_CALLBACK_OPENERS[sum % MISSED_CALLBACK_OPENERS.length]!;
}

export function missedCallbackNote(callId: string): string {
  return (
    `[they were promised a call back and never got it. Your FIRST sentence is exactly this, ` +
    `before any question: "${openerFor(callId)}" Then stop apologising: say it once, not twice. ` +
    `Do not explain why it happened, and do not blame the team, the office or anyone else. ` +
    `Next, in one short sentence, tell them you are putting this in as a second call so the ` +
    `team picks it up first, then carry on taking whatever detail is still missing. Never ` +
    `promise or guarantee that someone will call, and never give a time.]`
  );
}

/**
 * The follow-up the first apology always earns: "how do I know it'll
 * actually happen this time?" Seen on the real model immediately after the
 * apology landed, and answered with "Can you tell me what's going on with
 * the water heater?", which ignores the one thing the caller rang back
 * about.
 *
 * It needs its own note because the complaint pattern above does not match
 * a question about the FUTURE, so the turn that matters most arrived with
 * no instruction at all.
 */
const DOUBTS_IT_WILL_HAPPEN =
  /\bhow (?:do|can) i (?:know|be sure|trust)\b|\bwhat(?:'s| is) different this time\b|\bwill (?:it|this|that) actually happen\b|\b(?:don'?t|do not) want to (?:have to )?(?:call|ring|chase)\b|\bthird time\b|\bagain this time\b|\bhow sure\b|\bwhat if (?:no ?one|nobody) calls\b/i;

/** True when the caller doubts the call will come this time either. */
export function doubtsItWillHappen(transcript: string): boolean {
  return DOUBTS_IT_WILL_HAPPEN.test(transcript);
}

/**
 * What actually reassures someone here is not warmth, it is a concrete,
 * checkable difference. Grace cannot make anyone call, so she must not
 * promise; what she CAN say is true and specific: the request goes in
 * marked as a repeat, which is a real thing the team will see.
 *
 * Deliberately does not apologise again. By this turn the caller has
 * already had the apology, and repeating it reads as stalling.
 */
export const MISSED_CALLBACK_DOUBT_NOTE =
  "[ANSWER THIS, and say nothing else this turn: they are asking how they can " +
  "be sure the call comes this time. Two things only: you cannot promise a " +
  "time, and their request goes in marked as a second call so the team sees it " +
  "ahead of new ones. Ask no question at all this turn. Do not apologise again. " +
  "Never say they will not have to call again, or that someone definitely will " +
  "call: you cannot make that true, and a second broken promise is worse than the first.]";
