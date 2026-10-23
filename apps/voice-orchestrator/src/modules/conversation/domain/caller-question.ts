/**
 * 2026-10-22 tester call: "when asked 'can someone come out today?' it
 * skipped the question and followed the normal routine call."
 *
 * The prompt could hardly be firmer about this ("A caller's direct question
 * always comes first... If the caller asks something, your VERY NEXT
 * sentence must address it"), and the deterministic notes in this module's
 * neighbours then overrule it in the same message: the address readback says
 * "Ask nothing else", the callback nudge says "your reply asks only one
 * question", and both are the last instruction the model reads. A caller who
 * gives their address AND asks a question in one breath hits exactly that,
 * which is the shape the tester reported.
 *
 * So the notes stay (they fixed real bugs of their own) and gain one clause
 * when the caller actually asked something. That needs this: a reader of the
 * caller's words, with no punctuation to go on -- Deepgram is not asked for
 * it, so a transcript never contains a question mark.
 *
 * Narrow on purpose. An interrogative only counts at the START of a clause,
 * because mid-sentence it is usually a statement ("I don't know what
 * happened", "that's where it's leaking"), plus a short list of phrasings
 * that are unambiguous wherever they appear. A false positive costs one
 * unnecessary "answer first" clause on a turn with nothing to answer; a
 * false negative is the bug.
 */

/** Opens a clause: start of the utterance, or after a comma/dash/connective. */
const CLAUSE_START = "(?:^|[,;—–-]\\s*|\\b(?:and|but|so|or|also|then)\\s+)";

const AUXILIARY_QUESTION = new RegExp(
  `${CLAUSE_START}(?:can|could|will|would|do|does|did|is|are|was|were|am|have|has|should|shall|may|might)\\s+(?:i|you|we|he|she|it|they|someone|somebody|anyone|anybody|there|that|this|the|my|your|a|an)\\b`,
  "i",
);

const WH_QUESTION = new RegExp(
  `${CLAUSE_START}(?:what|when|where|why|who|whom|whose|which|how)\\b`,
  "i",
);

/** Unambiguous wherever they sit in the sentence. */
// 2026-10-23, live call: "so like do you guys even do that kind of
// conversion" went unanswered while Grace asked for a name; "you guys" and
// "even" kept it from matching anything here.
const QUESTION_PHRASES =
  /\b((do|can|could|will|would) (you guys|y'?all)|(you guys|y'?all) (even )?(do|offer|have|handle|service|install|fix|work)|do you (even|actually|also) (do|offer|have|handle|service|install|fix|work)|can someone|can somebody|can anyone|can you|could you|could someone|do you (have|offer|do|know|charge|take|service|work)|does (it|that|this) (cost|include)|is there (a|any|an)|are there (any|a)|how much|how long|how soon|how many|how fast|what time|what (do|does) (it|that|you)|any chance|is it possible|will someone|will somebody|will anyone|would it be possible|any idea (how|when|what))\b/i;

/**
 * A caller who is answering a question Grace just asked is not asking one,
 * however their answer begins. "Is that right? — is my home, yes" is the
 * shape to avoid; so is a bare confirmation.
 */
const PLAIN_ANSWER = /^\s*(yes|yeah|yep|no|nope|nah|correct|right|that'?s right|sure|okay|ok)\b/i;

/**
 * A tag question: a statement handed back for confirmation. The tester's own
 * words were "the kitchen sink and the toilet both are booked, not one
 * right?" -- no interrogative anywhere, and this module missed it on the
 * first pass. Everything above looks at how an utterance STARTS, and a tag
 * question is identified by how it ENDS.
 *
 * Requires some statement in front of the tag, so a bare "right" or "okay"
 * stays what it is: an acknowledgment. PLAIN_ANSWER is checked first for the
 * same reason -- "yes that's right" ends in "right" and is an answer.
 */
const TAG_QUESTION = /\b(right|correct|isn'?t it|aren'?t they|don'?t you|didn'?t i)\s*\??\s*$/i;
const TAG_MIN_WORDS = 4;

/** True when the caller's utterance contains a direct question that owes them an answer. */
export function callerAskedAQuestion(transcript: string): boolean {
  const text = transcript.trim();
  if (text.length === 0) {
    return false;
  }
  if (/\?/.test(text)) {
    return true;
  }
  if (QUESTION_PHRASES.test(text)) {
    return true;
  }
  if (PLAIN_ANSWER.test(text)) {
    return false;
  }
  if (text.split(/\s+/).length >= TAG_MIN_WORDS && TAG_QUESTION.test(text)) {
    return true;
  }
  return AUXILIARY_QUESTION.test(text) || WH_QUESTION.test(text);
}

/**
 * Appended INSIDE an existing directive note rather than added as a second
 * one. Exactly one directive note per turn is a hard-won rule here (two
 * notes each claiming to be "your whole reply" is what produced garbled,
 * non-sequitur replies on 2026-10-14), so this cannot be its own note.
 */
export function answerFirst(note: string): string {
  // The "ask nothing else" sentence comes OUT rather than being argued with.
  // Two contradictory instructions in one note is the documented cause of
  // garbled replies here (2026-10-14), so the note must read as one
  // consistent thing: answer them, then do this.
  return note
    .replace(/\s*(?:Ask nothing else\.|Do not ask anything else this turn\.)/g, "")
    .replace(
      /\]\s*$/,
      " The caller also just asked you something: answer that in one short sentence first, in this same reply, then do the above and nothing more.]",
    );
}

/**
 * The turn's one directive note when the caller asked something and nothing
 * else needed saying. 2026-10-22 tester call: asked whether both problems
 * were booked, Grace replied "you are all set, anything else" and only then
 * answered. Kept to one sentence: it is reinforcing a rule the prompt
 * already states, not introducing a new one.
 */
export const ANSWER_THE_QUESTION_NOTE =
  "[The caller just asked you something. Your FIRST sentence answers it, in their terms, " +
  "before anything else -- never a wrap-up, a read-back or the next question first.]";
