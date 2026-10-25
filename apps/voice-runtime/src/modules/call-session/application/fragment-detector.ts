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
  // 2026-10-23, live call: a caller said "it's", paused to read the
  // address, and Grace answered "it seems like your response got cut off".
  // "it's" at the end is the start of an answer, never the whole of one.
  "it's",
  "its",
  "i'm",
  "im",
  // 2026-10-24 test calls, each answered before the caller finished:
  // "that's" (then "i can get a number today for my"), "my name's" (then
  // "alejandro montalde"), "and my service address is basically" (then
  // "one one nine zero").
  "that's",
  "thats",
  "name's",
  "basically",
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
/** What can come before an unfinished "my name"; see fragmentStrength. */
const BEFORE_MY_NAME = new Set([
  "hi",
  "hello",
  "hey",
  "okay",
  "ok",
  "so",
  "and",
  "yes",
  "yeah",
  "well",
  "um",
  "uh",
  "grace",
  "sure",
]);
const ENDS_A_SENTENCE = new Set(["on", "in", "at", "was", "are", "am"]);
/**
 * The rest of the trailing words that often end a complete sentence ("what
 * is it for", "who am I speaking with"). A long utterance ending on one gets
 * the short hold instead of the long one; determiners, conjunctions and
 * "is"/"to" keep the long hold at any length ("the address is", "i want to").
 */
const SOFT_TRAILING_WORDS = new Set([
  // "it's been leaking for a week basically" is finished; "my address is
  // basically" is not. A long one gets the short hold.
  "basically",
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
  // 2026-10-23 client call: "triple four" was not read as digits at all, so
  // the house number became "4" and nothing held for the rest of it.
  let repeat = 1;
  for (const raw of words) {
    const word = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (word.length === 0) {
      continue;
    }
    if (REPEATERS[word]) {
      repeat = REPEATERS[word];
      continue;
    }
    if (/^\d+$/.test(word)) {
      digits += word.repeat(word.length === 1 ? repeat : 1);
    } else if (SPOKEN_DIGITS[word]) {
      digits += SPOKEN_DIGITS[word].repeat(repeat);
    } else {
      return null;
    }
    repeat = 1;
  }
  return digits.length > 0 && repeat === 1 ? digits : null;
}

const REPEATERS: Record<string, number> = { double: 2, triple: 3 };
/** Spoken numbers that are not single digits ("fifty three one two", "eleven hundred"). */
const NUMBER_WORDS = new Set([
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
  "twenty",
  "thirty",
  "forty",
  "fifty",
  "sixty",
  "seventy",
  "eighty",
  "ninety",
  "hundred",
  "thousand",
]);

/** The digits the caller said last, as one run ("... nine eight one two one" gives "98121"). */
function trailingDigits(words: readonly string[]): string {
  let start = words.length;
  while (start > 0 && isNumberWord(words[start - 1]!)) {
    start -= 1;
  }
  return start < words.length ? spokenNumber(words.slice(start)) : "";
}

const TEENS: Record<string, number> = {
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

function isNumberWord(word: string): boolean {
  return (
    /^\d+$/.test(word) ||
    SPOKEN_DIGITS[word] !== undefined ||
    REPEATERS[word] !== undefined ||
    TEENS[word] !== undefined ||
    TENS[word] !== undefined ||
    word === "hundred" ||
    word === "thousand" ||
    word === "and"
  );
}

/**
 * The digits a run of spoken number words stands for, the way people say a
 * ZIP or a house number: "nine eight one oh three", "ninety eight one oh
 * three" and "ninety eight thousand one hundred three" are all 98103. With
 * "hundred" or "thousand" in it the run is read as one quantity; without,
 * each piece is its own group of digits. Empty when it does not parse.
 */
function spokenNumber(words: readonly string[]): string {
  const run = words.filter((word, index) => word !== "and" || index > 0);
  if (run.includes("hundred") || run.includes("thousand")) {
    let total = 0;
    let current = 0;
    for (const word of run) {
      if (word === "and") {
        continue;
      }
      if (word === "thousand") {
        total += (current || 1) * 1000;
        current = 0;
      } else if (word === "hundred") {
        current = (current || 1) * 100;
      } else if (TENS[word] !== undefined) {
        current += TENS[word];
      } else if (TEENS[word] !== undefined) {
        current += TEENS[word];
      } else if (SPOKEN_DIGITS[word] !== undefined) {
        current += Number(SPOKEN_DIGITS[word]);
      } else if (/^\d+$/.test(word)) {
        current += Number(word);
      } else {
        return "";
      }
    }
    return String(total + current);
  }
  let digits = "";
  for (let i = 0; i < run.length; i += 1) {
    const word = run[i]!;
    const next = run[i + 1] ?? "";
    if (TENS[word] !== undefined) {
      const unit = SPOKEN_DIGITS[next];
      if (unit !== undefined && next !== "oh" && next !== "o" && next !== "zero") {
        digits += String(TENS[word] + Number(unit));
        i += 1;
      } else {
        digits += String(TENS[word]);
      }
    } else if (TEENS[word] !== undefined) {
      digits += String(TEENS[word]);
    } else if (word === "and") {
      continue;
    } else {
      const piece = spokenDigitsOnly(run.slice(i, i + (REPEATERS[word] ? 2 : 1)));
      if (piece === null) {
        return "";
      }
      digits += piece;
      if (REPEATERS[word]) {
        i += 1;
      }
    }
  }
  return digits;
}

/** Grace's question was about where the job is. */
const ADDRESS_ASKED =
  /\b(address|street|house number|zip|zip code|postal code|unit number|apartment number|where (?:is|are) (?:the|your) (?:home|house|property))\b/i;
/** The caller announced an address in their own words. */
const ADDRESS_ANNOUNCED = /\b(my address|address is|i live (?:at|on)|located (?:at|on)|i'?m at)\b/i;
/** A question about the whole address, not only the street. */
const WHOLE_ADDRESS_ASKED = /\b(address|zip|city|postal code)\b/i;
/** The street-type word that completes "<number> <name> <type>". */
const STREET_TYPE =
  /\b(street|st|avenue|ave|road|rd|drive|dr|lane|ln|way|place|pl|court|ct|boulevard|blvd|circle|terrace|parkway|highway|hwy)\b/i;
/** Grace reading something back for a yes or no: our own hyphenated digits, or an "is that right?". */
const READBACK = /\d-\d|\b(is that (?:right|correct)|right\?|correct\?|all correct)/i;
/** The caller answering that readback. */
const CONFIRMS =
  /^\s*(?:(?:oh|okay|ok|um|uh|well)\s+)?(?:yes|yeah|yep|yup|sure|okay|ok|correct|right|that'?s (?:right|correct)|exactly|no|nope)\b/i;
/** Words that only make sense as part of an address. */
const ADDRESS_WORDS =
  /\b(street|st|avenue|ave|road|rd|drive|dr|lane|ln|way|place|pl|court|ct|boulevard|blvd|circle|terrace|parkway|highway|hwy|north|south|east|west|northeast|northwest|southeast|southwest|unit|apartment|apt|suite|seattle|washington|wa)\b/i;

/**
 * The caller is part-way through giving an address, and the rest is coming.
 *
 * 2026-10-23 client call: asked for the address, the caller read it in six
 * pieces with a pause of a second or two between each ("yes my address is
 * one", "triple four", "north avenue", "sixtieth street", "nine eight two
 * zero one", "seattle washington"). Each pause ended a turn. Grace answered
 * every piece ("What's the complete street address?") and was talked over
 * every time, which the caller heard as her voice "getting broken again and
 * again", and the address saved was wrong.
 *
 * Held while: the address was asked for (or announced), what has arrived so
 * far carries address material (a number or an address word), and it does
 * not yet END on a ZIP. A ZIP at the end is the natural close of an address,
 * so that turn goes through at once, with no added wait.
 */
/**
 * How long to hold, given that the address is still coming: longer while the
 * caller has said only a number so far, since that is where people stop to
 * look the rest up. 2026-10-23, three live calls: after a bare house number
 * ("the address is twelve fifteen", "it's it's two o o", "fourteen ninety")
 * callers resumed about 4.5 s after it was transcribed, and the 2 s hold had
 * Grace already asking for the street.
 */
export function addressHoldMs(saidSoFar: string): number {
  return ADDRESS_WORDS.test(saidSoFar) ? ADDRESS_HOLD_WITH_STREET_MS : ADDRESS_HOLD_NUMBER_ONLY_MS;
}
const ADDRESS_HOLD_NUMBER_ONLY_MS = 3500;
const ADDRESS_HOLD_WITH_STREET_MS = 2500;

export function addressStillComing(saidSoFar: string, lastAgentText: string): boolean {
  if (!ADDRESS_ASKED.test(lastAgentText) && !ADDRESS_ANNOUNCED.test(saidSoFar)) {
    return false;
  }
  // A yes or no to Grace's own readback is an answer, not an address being
  // read out, even when the caller repeats some of it.
  if (READBACK.test(lastAgentText) && CONFIRMS.test(saidSoFar)) {
    return false;
  }
  const words = saidSoFar
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.replace(/[^a-z0-9']/g, ""))
    .filter((word) => word.length > 0);
  if (words.length === 0) {
    return false;
  }
  // "oh" and "o" are digits only inside a run of numbers; alone they are the
  // filler that opens half of all answers ("oh yes").
  const hasNumber = words.some(
    (word) =>
      /^\d+$/.test(word) ||
      (SPOKEN_DIGITS[word] !== undefined && word !== "oh" && word !== "o") ||
      REPEATERS[word] !== undefined ||
      NUMBER_WORDS.has(word),
  );
  if (!hasNumber && !ADDRESS_WORDS.test(saidSoFar)) {
    return false;
  }
  if (trailingDigits(words).length === 5) {
    return false;
  }
  // A number and a street type is a whole street, which is the whole answer
  // to "what's the house number and street name?": holding it would only add
  // a wait. Asked for the ADDRESS (or the ZIP or city), the caller goes on to
  // the ZIP, which is what the hold is for.
  const wholeAddressAsked =
    WHOLE_ADDRESS_ASKED.test(lastAgentText) || ADDRESS_ANNOUNCED.test(saidSoFar);
  return wholeAddressAsked || !(hasNumber && STREET_TYPE.test(saidSoFar));
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
  // 2026-10-24, Prateek's test call: "hi my name", a pause, then "robert
  // fightingson". Grace had already begun "I didn't quite catch...". Only
  // after a greeting or filler: "what's my name" and "do you know my name"
  // are whole questions (both in the last two weeks of real calls).
  if (
    last === "name" &&
    words.length >= 2 &&
    normalizeWord(words[words.length - 2]!) === "my" &&
    words.slice(0, -2).every((word) => BEFORE_MY_NAME.has(normalizeWord(word)))
  ) {
    return "strong";
  }
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
