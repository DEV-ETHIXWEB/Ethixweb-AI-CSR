/**
 * A conservative, evidence-based heuristic for "this finalized transcript
 * is very unlikely to be a complete thought on its own" — see
 * call-session-orchestrator.ts's own comment on `FRAGMENT_COALESCE_WINDOW_MS`
 * for the real-call evidence this exists to close: Deepgram's own
 * endpointing (500ms of clean silence) correctly, per its own configured
 * threshold, finalized a caller's genuinely-still-forming thought multiple
 * times in one real call ("can you" / "oh sorry like" / ...), each one
 * treated as its own complete, independent turn — the caller was mid-
 * sentence, not done, for gaps as long as ~2.5s.
 *
 * Two INDEPENDENT signals, deliberately not combined behind one shared
 * gate — a v2 revision found the v1 design conflating them cost real
 * accuracy in both directions (see below):
 *
 *   1. TRAILING word — ending in a determiner ("my", "the", "a"), a
 *      preposition ("to", "of", "for", "in"), a conjunction ("and",
 *      "but", "or"), or a trailing filler ("like", "um", "uh") is
 *      grammatically incomplete REGARDLESS of how long the utterance
 *      already is — "I was trying to explain to you about the" is just
 *      as unfinished as "i was fixing my", it's simply longer. Checked
 *      with NO word-count limit for exactly that reason (v1 gated this
 *      behind the same ≤4-word cap as the opening-word check below,
 *      which meant a long trail-off never got caught at all).
 *   2. OPENING with a MODAL/auxiliary REQUEST verb ("can", "could",
 *      "do", "will", "would", "should", "shall") in a genuinely SHORT
 *      utterance (≤4 words) — a caller essentially never leaves a bare
 *      "Can you" or "Do you" as their WHOLE utterance. Deliberately
 *      narrower than v1: v1 also included the copula/"be" forms ("is",
 *      "are", "was", "were", "am") and WH-words as openers, which
 *      flagged "Are you there?" and "Is that right?" — both genuinely
 *      complete, common caller questions, one of them an EXPLICIT
 *      required test scenario ("are you there?") this codebase's own
 *      silence-check-in and dead-air handling exists to answer promptly.
 *      Delaying exactly that question by a bounded wait, right when
 *      responsiveness matters most to an uncertain caller, was a real
 *      regression v1 would have shipped. Modal request-verbs don't have
 *      this problem: nobody says "Can?" or "Will?" as a complete
 *      question on their own.
 *
 * Neither signal is proof by itself, and this will occasionally be wrong
 * in both directions — that's an accepted, bounded cost (see
 * `FRAGMENT_COALESCE_WINDOW_MS`'s own comment for what a false positive
 * actually costs: one bounded extra wait, not a lost turn), not a claim
 * of a solved, precise grammar classifier. A false negative (a real
 * fragment this doesn't catch) is simply the pre-existing behavior,
 * unchanged — this can only ever make fragmentation handling BETTER than
 * before, never worse, since it only ever adds a bounded wait to a
 * narrow subset of turns that would otherwise have committed immediately.
 *
 * 3. PHONETIC SPELLING ("k for kite", "a for apple") — found on a real
 *    call forensically reviewed after the caller directly complained,
 *    live, that Grace wasn't waiting for him to finish. He was spelling
 *    his name out letter by letter using the common "LETTER for WORD"
 *    convention (itself now far more common precisely because this
 *    platform's own prompt rule, prompt-layers.ts's v24, asks Grace to
 *    read spellings back and ask callers to confirm them). "k for kite"
 *    is grammatically a complete phrase — neither of the two signals
 *    above catches it — but a caller who has just spelled ONE letter
 *    this way is virtually always about to spell MORE; treating it as
 *    a finished, standalone turn is exactly backwards. In the real call,
 *    "k for kite" finalized, then "yeah" finalized 1106ms later — inside
 *    `FRAGMENT_COALESCE_WINDOW_MS` (1200ms) — meaning correctly flagging
 *    "k for kite" here would have coalesced the two into one turn
 *    instead of two separate ~4s process-then-abort cycles, which is the
 *    actual mechanism behind what the caller experienced as Grace
 *    talking over him: each short fragment independently triggered a
 *    full turn, and his own next word barged in on it before it could
 *    finish, again and again.
 */
const PHONETIC_SPELLING_PATTERN = /^[a-z]\s+for\s+[a-z']+[.!?]?$/i;
const OPENING_WORD_COUNT_MAX = 4;

const OPENING_WORDS = new Set([
  "can",
  "could",
  "do",
  "does",
  "did",
  "will",
  "would",
  "should",
  "shall",
]);

const TRAILING_WORDS = new Set([
  "my",
  "your",
  "his",
  "her",
  "our",
  "their",
  "the",
  "a",
  "an",
  "to",
  "of",
  "for",
  "in",
  "on",
  "at",
  "with",
  "about",
  "like",
  "and",
  "but",
  "or",
  "so",
  "um",
  "uh",
  "is",
  "was",
  "are",
  "am",
  "because",
  "if",
  "when",
  "where",
  "which",
  "by",
  // "from" removed 2026-10-14: a real test call showed "I don't know where
  // from." held for the full STRONG_FRAGMENT_HOLD_MS as an "unfinished"
  // sentence, when it's actually a complete answer — "from" very commonly
  // ends a real spoken sentence in this domain ("where it's leaking from",
  // "who the call is from"), unlike the other trailing words here, which
  // this codebase has live evidence are reliably incomplete on their own.
  "into",
  "than",
  "also",
  "as",
  "some",
  "any",
  "we",
]);

/**
 * 2026-10-23, client: "when I end saying something it usually takes 5 full
 * seconds to answer". Run over 800 real caller lines from the last ten days,
 * the four-second hold caught complete sentences that simply END on one of
 * these words: "it only happens when i turn the water on", "i'd like to get
 * it looked at", "i wanted to find out what my options are", "what did you
 * say my name was". Every one sat in four seconds of silence, plus the turn.
 *
 * A short utterance ending on them still holds ("i'm at", "my house is in"):
 * that is someone about to give the rest. A longer one has already said its
 * piece; these words are stranded particles there, not openings.
 */
const LONG_UTTERANCE_WORDS = 5;
const ENDS_A_SENTENCE = new Set(["on", "in", "at", "was", "are", "am"]);
/**
 * The rest of the trailing words that often end a complete sentence ("what
 * is it for", "who am I speaking with"). A long utterance ending on one gets
 * the short hold instead of the long one; determiners, conjunctions and
 * "is"/"to" keep the long hold at any length ("the address is", "i want to").
 */
const SOFT_TRAILING_WORDS = new Set([
  "about",
  "for",
  "with",
  "like",
  "by",
  "into",
  "than",
  "as",
  "some",
  "any",
  "also",
  "we",
  "when",
  "where",
  "which",
]);

const SPOKEN_DIGITS: Record<string, string> = {
  zero: "0",
  oh: "0",
  o: "0",
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
};

/**
 * Client feedback (previous vendor's calls, Oct 4 and Oct 7): the CSR cut in
 * while a caller was still reading out a ZIP, then moved on without it. People
 * say numbers in groups with pauses ("nine eight", "two oh six ... four oh
 * nine"), and each pause reaches us as a finished utterance. An utterance made
 * only of digits is held like any other strong fragment unless it is already a
 * whole ZIP (5 digits) or a whole phone number (10 or 11). A single digit is
 * left alone: "two" is far more often a complete answer ("how many
 * bathrooms?") than the start of a number.
 */
function spokenDigitsOnly(words: readonly string[]): string | null {
  let digits = "";
  for (const raw of words) {
    const word = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (word.length === 0) {
      continue;
    }
    if (/^\d+$/.test(word)) {
      digits += word;
    } else if (SPOKEN_DIGITS[word]) {
      digits += SPOKEN_DIGITS[word];
    } else {
      return null;
    }
  }
  return digits.length > 0 ? digits : null;
}

function isPartialNumber(words: readonly string[]): boolean {
  const digits = spokenDigitsOnly(words);
  return digits !== null && digits.length >= 2 && ![5, 10, 11].includes(digits.length);
}

/**
 * Whether this utterance is held because it MIGHT be half of a number, as
 * opposed to a sentence that is grammatically unfinished.
 *
 * 2026-10-22, from a client call: "there is a significant delay between when
 * I finish speaking and when I receive a response". Measured, and a house
 * number is the worst case by far: "four five one two" is a partial number
 * (four digits, not a ZIP and not a phone), so it took the STRONG hold of a
 * full four seconds before the turn even started. Every address turn paid
 * that.
 *
 * The strong hold is right for "I was fixing my", where the caller is
 * genuinely mid-thought and may take seconds to continue. A number is not
 * that: Deepgram only finalises after 500ms of silence, so a caller still
 * reading digits continues well inside a second. The call site uses this to
 * pick a much shorter wait, which is the difference between a pause and a
 * silence.
 */
export function isPartialNumberUtterance(transcript: string): boolean {
  const words = transcript
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0);
  return words.length > 0 && isPartialNumber(words);
}

/**
 * 2026-10-22 tester call, twice: "I said 4512, it only registered 512."
 *
 * The leading digit was never misheard. Deepgram endpointed after it, so
 * "four" arrived as its own finalized utterance and "512 Maple Street"
 * as the next one. A lone digit used to be the one numeric utterance
 * treated as a finished thought (the comment this replaces reasoned that
 * "two" answers "how many bathrooms?" more often than it starts a
 * number) -- so it committed immediately, ran a turn of its own, and the
 * house number the model actually saw began at the second digit.
 *
 * Held WEAK, not strong: the bathrooms case is real, and a weak hold is
 * the short coalesce window rather than the multi-second one. A caller
 * whose answer genuinely is one digit waits ~1.2s; a caller reading out a
 * house number keeps their first digit.
 */
function isLoneDigit(words: readonly string[]): boolean {
  return spokenDigitsOnly(words)?.length === 1;
}

function normalizeWord(word: string): string {
  return word.toLowerCase().replace(/[^a-z']/g, "");
}

export type FragmentStrength = "none" | "weak" | "strong";

/**
 * "strong": the words end on something no finished sentence ends on ("...
 * let me check on", "... my name is") or the caller is spelling something
 * out. The caller is plainly still talking, so the runtime waits long for
 * the rest, in silence. "weak": only the OPENING of the utterance looks
 * unfinished ("so", "actually my"), which a short complete answer can also
 * do, so the wait stays short. "none": treat it as a finished utterance.
 *
 * Client feedback: Grace answered mid-sentence fragments with "go ahead",
 * "take your time" and "I'm still here" while the caller was still talking,
 * and the reply to the fragment then talked over the real answer.
 */
export function fragmentStrength(transcript: string): FragmentStrength {
  const words = transcript
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0);
  if (words.length === 0) {
    return "none";
  }
  if (PHONETIC_SPELLING_PATTERN.test(transcript.trim())) {
    return "strong";
  }
  if (words.length === 1 && /^[a-z]$/i.test(normalizeWord(words[0]!))) {
    return "strong";
  }
  const last = normalizeWord(words[words.length - 1]!);
  // A spelled-out name ending in "a" ("s u m a l i a"): that "a" is a letter,
  // not the article (2026-10-14 tester call).
  const spelling = words.length >= 2 && normalizeWord(words[words.length - 2]!).length === 1;
  if (TRAILING_WORDS.has(last) && !spelling) {
    if (words.length >= LONG_UTTERANCE_WORDS && ENDS_A_SENTENCE.has(last)) {
      return "none";
    }
    if (words.length >= LONG_UTTERANCE_WORDS && SOFT_TRAILING_WORDS.has(last)) {
      return "weak";
    }
    return "strong";
  }
  if (isPartialNumber(words)) {
    return "strong";
  }
  if (isSpellingInProgress(words)) {
    return "strong";
  }
  if (isLoneDigit(words)) {
    return "weak";
  }
  if (words.length > OPENING_WORD_COUNT_MAX) {
    return "none";
  }
  const first = normalizeWord(words[0]!);
  return OPENING_WORDS.has(first) ? "weak" : "none";
}

/**
 * The caller has STARTED spelling and is not finished.
 *
 * FOUND ON A LIVE CALL, 2026-10-22. The caller's name was not being heard,
 * so they announced a spelling, and the transcript committed after two
 * letters:
 *   caller: "i'm gonna spell out my name s y"
 *   Grace:  "Got it, Josh, spelled J-O-S-H."
 * Grace asserted a guessed spelling over the letters the caller was in the
 * middle of giving.
 *
 * The length of the trailing run is what separates this from the case the
 * 2026-10-14 fix protects. "marisa m a r i s a" ends in six letters and is
 * a COMPLETE spelling, which must not be held (holding it left Grace saying
 * only "Mm-hm" and then "I'm still here"). One to three trailing letters is
 * a spelling that has just begun, and the rest is still coming.
 */
const SPELLING_IN_PROGRESS_MAX_LETTERS = 3;

function isSpellingInProgress(words: readonly string[]): boolean {
  let run = 0;
  let letters = "";
  for (let index = words.length - 1; index >= 0; index -= 1) {
    const word = normalizeWord(words[index]!);
    if (word.length !== 1 || !/[a-z]/.test(word)) {
      break;
    }
    run += 1;
    letters = word + letters;
  }
  // A run of 0 is not a spelling at all, and the whole utterance being one
  // letter is already handled above as its own case.
  if (run >= 1 && run <= SPELLING_IN_PROGRESS_MAX_LETTERS && run < words.length) {
    return true;
  }
  // 2026-10-23, client call: "the last name is lindquist l i n d", a pause,
  // then "q v i s t". Four letters is past the limit above, so it committed,
  // and Grace answered "Your name is Qvist". Letters that are the start of a
  // word the caller has just said, and stop short of it, cannot be finished.
  return (
    run >= 2 &&
    words
      .slice(0, words.length - run)
      .map((word) => normalizeWord(word))
      .some((word) => word.length > letters.length && word.startsWith(letters))
  );
}

export function looksLikeIncompleteFragment(transcript: string): boolean {
  return fragmentStrength(transcript) !== "none";
}
