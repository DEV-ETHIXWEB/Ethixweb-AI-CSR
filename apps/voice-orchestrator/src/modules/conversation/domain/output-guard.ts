/**
 * Last line of defense on what Grace SAYS, applied to each speech segment
 * just before it is streamed to the voice. Prompt rules get followed most of
 * the time; these are the patterns the clients' real test calls showed
 * leaking through anyway, so they are enforced in code:
 *
 *  1. Reasoning leaked into speech: on a goodbye the model said "George
 *     already said goodbye and ended the call... Per the instructions, a
 *     caller who signs off gets let go". Dropped.
 *  2. Timing promises: "they'll call you back to lock in a time today",
 *     "Got you down for today". There is no live schedule, so any promise of
 *     a day or time is replaced with an honest line.
 *  3. Claiming an appointment change was made: "Let me get that cancelled
 *     for you." Nothing can be cancelled or rescheduled from a call.
 *  4. Address and phone read-backs "not clearly hearable" (client feedback):
 *     prefixed with the [slowly] delivery cue, which the voice runtime turns
 *     into a slower speaking rate.
 *
 * Rewrites are deliberately blunt and rare; every one is reported so it can
 * be counted and the prompt fixed at the source.
 */

import { editDistanceAtMostOne } from "./name-grounding";

export const SAFE_TIMING_LINE = "The team will confirm the timing with you.";
export const SAFE_PREFERENCE_LINE =
  "I'll note that preference, and the team will confirm the time.";
export const SAFE_CAUSE_LINE = "A technician will need to look at that to confirm.";
export const SAFE_CHANGE_LINE =
  "I can't change appointments from here, but I'll pass this to the team and they'll confirm it with you.";

const META_LEAK =
  /\b(per (the|my) (instructions?|prompt|rules?|guidelines?)|according to (the|my) (instructions?|prompt|guidelines?)|the (caller|customer) (has|had|already|just|is|said|wants|signed)|already said goodbye|ended the call|the call is over|system note|as an ai\b|my (system )?prompt|no further (response|action) (is )?(needed|required|necessary)|\b(this|that|my|the next|in this) turn\b|(i'?m |i am |i'?ve |i have )(flagg|mark)(ed|ing) (this|it|that)( as| now|\b)|\bretrying\b|(i'?m|i am) (checking|looking into|looking up|pulling up) (that|this|it|your)\b|\blet me (check|look up|pull up|look into|see) (that|this|it|your|on that|how)\b|\b(saving|submitting|sending) (your|the|this) (request|info|information|details|lead)( now)?\b)/i;

/**
 * QA 2026-10-13, on Claude Haiku 5.5 with thinking off: the model wrote its
 * reasoning as the reply ("Caller is speaking Spanish. Need to call
 * escalateEmergency since they describe a problem..."). Nothing Grace says to
 * a caller ever names a tool, talks about "the caller" in the third person, or
 * starts with "Need to", so such sentences are dropped.
 */
const REASONING_LEAK =
  /\b(the|in the|request|call|my) notes\b|\b(refused|rejected)\b|\b(complaint|new|the|a|this) lead\b|\bcreate (the|a) (lead|record|request)\b|\b(i'?ll|i will|let me|i need to) save\b|\b(couldn'?t|could not|can'?t|cannot) (update|save|add|submit|create)\b|\b(on file|in (the|our) system|the record)\b|\b(escalateEmergency|createCustomer|createLead|updateLead|searchCustomer|transferToHuman|getServiceAreas|getBusinessHours|lookupPreviousCalls)\b|\bcaller\b|^\s*(i )?need to (call|ask|check|use|run|respond|reply|confirm|get)\b|^\s*(speak|respond|reply) (in|with)\b/i;

/** A sentence that is only an acknowledgment, with no information in it. */
const PURE_ACK =
  /^(got it|okay|ok|alright|all right|right|sure|perfect|great|gotcha|thanks|thank you|no problem|mm-?hm|understood|thanks for (telling|letting) me( know)?)[.!]?$/i;
/** "today"/"tonight" in Grace's own statements; the client asked that she never say them (v49). */
const OWN_TODAY = /\b(today|tonight)\b/gi;

const TIME_WORD =
  /\b(today|tonight|this (morning|afternoon|evening)|same[- ]day|tomorrow|next (day|morning)|within (the )?(next )?(\d+|an?|one|two|three|few) ?(hours?|minutes?|mins?)|in (about |around )?(an|\d+) (hour|hours|minutes)|by (tonight|tomorrow|end of (the )?day))\b/i;

/** Statements that book or agree a slot, whatever the subject. */
const HARD_PROMISE =
  /\b(got|have|put) you (down|booked|scheduled|set up|on the schedule)\b|\b(booked|scheduled|locked in) for\b|\block(?:ed)? in (a|the) time\b|\b(works|is fine|sounds good|is good|will work)\b/i;

/** A team member acting at a time, or a modal about the team. */
const SOFT_PROMISE = /('ll|\bwill\b|\bcan\b|\bcould\b|\bgoing to\b|\bgonna\b|\bshould\b)/i;

const HEDGE =
  /\b(can'?t|cannot|unable|not able|no promise|won'?t|note|noted|prefer|preference|depends|if possible|may|might|possibly|possible|sometimes|usually|typically|hopefully|try|whether|open|24\/7)\b/i;

const CHANGE_CLAIM =
  /\b(i'?ve|i have|it'?s|that'?s|you'?re|has been|have been|is now|are now)\b[^.?!]{0,30}\b(cancell?ed|rescheduled|moved|booked)\b|\blet me (get|have) that (cancell?ed|rescheduled|moved)\b|\b(cancell?ed|rescheduled) (it |that )?(for you|your appointment)\b/i;

/** A guess at what causes or links problems, which cannot be known from a phone call. */
const CAUSE_CLAIM =
  /\b(could|might|may|probably|likely|usually|possibly|sounds like|typically)\b[^.?!]{0,60}\b(connected|related|linked|ties? to|tied to|caused by|due to|the same (issue|problem|clog|drain|line|cause|leak))\b|\b(usually|probably|typically|often) (a|the) (worn|faulty|clogged|bad|broken|loose|cracked)\b|\b(usually|probably|typically) (ties|points) to\b/i;

const CHANGE_HEDGE = /\b(can'?t|cannot|unable|not able|won'?t)\b/i;

const STREET_READBACK =
  /\b\d{1,6}\s+(?:[A-Za-z0-9'.]+\s+){0,3}(?:street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|lane|ln|way|place|pl|court|ct|circle|cir|terrace|ter|parkway|pkwy|highway|hwy)\b/i;

/**
 * 2026-10-22 tester call: "It took the address and it repeated the address
 * very fastly and again in a garbling manner."
 *
 * Both symptoms are one miss. STREET_READBACK needs the street TYPE word in
 * the same breath as the number, and a readback often does not have it --
 * "So that's 4512 Maple?", or the sentence arrives split across two speech
 * segments with the number in one and "Street" in the other. With no match,
 * the segment loses both of its readback protections at once: the [slowly]
 * cue (so it is spoken at whatever rate the mood cue set, up to 0.97 against
 * the readback's 0.84) and hyphenation (so "4512" is read "forty-five
 * twelve" instead of "4-5-1-2"). Fast, and garbled.
 *
 * Guessing harder at the text is the wrong fix: the turn already KNOWS the
 * house number the caller gave, from the same call notes the model is shown.
 * Given it, a segment containing those digits is a readback whatever else is
 * in the segment.
 */
function mentionsHouseNumber(sentence: string, houseNumber: string): boolean {
  if (houseNumber.length < 3) {
    return false;
  }
  return sentence.replace(/[\s-]/g, "").includes(houseNumber);
}
const DIGIT_READBACK = /\b(?:\d[\s-]){4,}\d\b|\b\d{5}\b|\b\d{3}[-. ]\d{3}[-. ]\d{4}\b/;

/**
 * Client feedback: ElevenLabs reads "14101" as "fourteen" + "oh one oh one"
 * with an awkward split, not digit-by-digit. Hyphenating forces TTS to read
 * each digit separately, like a real receptionist would. Zeros become "oh"
 * ("6-2-oh-4") because ElevenLabs garbles an isolated "0" into something
 * that sounds like a different letter (client reported "6204" heard as "62L4").
 * Only applied inside the readback path (STREET_READBACK matched), never to
 * bare numbers in normal speech.
 */
const spellDigits = (digits: string): string =>
  digits
    .split("")
    .map((d) => (d === "0" ? "oh" : d))
    .join("-");

function hyphenateHouseNumber(sentence: string, houseNumber: string | null): string {
  const bySuffix = sentence.replace(
    /\b(\d{3,6})\b(?=\s+(?:[A-Za-z0-9'.]+\s+){0,3}(?:street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|lane|ln|way|place|pl|court|ct|circle|cir|terrace|ter|parkway|pkwy|highway|hwy)\b)/gi,
    (_, digits: string) => spellDigits(digits),
  );
  // The street type is often not in the same sentence as the number ("So
  // that's 4512 Maple?") -- see mentionsHouseNumber. The number the caller
  // actually gave is spelled out wherever it appears, which is the half of
  // the garbled-readback fix that the pattern above cannot reach.
  if (!houseNumber || houseNumber.length < 3) {
    return bySuffix;
  }
  return bySuffix.replace(new RegExp(`\\b${houseNumber}\\b`, "g"), spellDigits(houseNumber));
}

export type GuardAction =
  | "meta_leak"
  | "timing_promise"
  | "change_claim"
  | "cause_claim"
  | "slow_readback"
  | "repeated_statement"
  | "word_limit"
  | "wrong_name"
  | "wrong_spelling"
  | "wrong_phone_readback";

/**
 * 2026-10-23 client call: the callback number read back as
 * "8-7-2-2-7-8-4-9-9", one digit short, and the caller said yes to it. Another
 * call read it with the "+1" the prompt says to leave out. The note gives the
 * model the exact digits; it still slips. A number read back within two
 * digits of a number this call actually has is that number, so it is said
 * exactly. Anything further off is left alone: it is a different number.
 */
const PHONE_RUN = /(?:\+\s?1[\s.-]*)?(?:\d[\s.()-]{0,2}){6,10}\d/g;
const PHONE_READBACK_MAX_EDITS = 2;

function withTheRealNumber(sentence: string, knownPhones: readonly string[]): string {
  if (knownPhones.length === 0) {
    return sentence;
  }
  return sentence.replace(PHONE_RUN, (run) => {
    let digits = run.replace(/\D/g, "");
    if (digits.length === 11 && digits.startsWith("1")) {
      digits = digits.slice(1);
    }
    if (digits.length < 8 || digits.length > 10) {
      return run;
    }
    const nearest = knownPhones
      .map((phone) => ({ phone, edits: editDistance(digits, phone) }))
      .sort((a, b) => a.edits - b.edits)[0]!;
    return nearest.edits <= PHONE_READBACK_MAX_EDITS ? spellDigits(nearest.phone) : run;
  });
}

function editDistance(a: string, b: string): number {
  const previous = Array.from({ length: b.length + 1 }, (_, k) => k);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = previous[0]!;
    previous[0] = i;
    for (let k = 1; k <= b.length; k += 1) {
      const above = previous[k]!;
      previous[k] = Math.min(
        above + 1,
        previous[k - 1]! + 1,
        diagonal + (a[i - 1] === b[k - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return previous[b.length]!;
}

/**
 * 2026-10-22 tester call: "Called as a returning customer, also gave name in
 * starting, but still near the end of the call it changed the name completely
 * to something else."
 *
 * Several people share a phone number, so the prompt already forbids ever
 * saying a stored name ("# RETURNING CALLERS": never say a stored name, treat
 * every caller as new). Late in a long call that rule loses to whatever name
 * is nearest in context -- the matched record's, or a plain mishearing -- and
 * being called by a stranger's name at the close undoes the whole call.
 *
 * Nothing invents or substitutes a name here: a name Grace was NOT given is
 * simply not spoken. Addressing someone by no name reads as normal; by the
 * wrong one does not.
 *
 * Only the two forms Grace actually uses are touched, both of them vocative:
 * a trailing ", Dana" at the end of a sentence, and a greeting or thanks
 * followed by a name. A name used any other way (a street called Dana Avenue,
 * a technician the caller asked for) is left exactly as written.
 */
const VOCATIVE_TRAILING = /,\s+([A-Z][a-z'’-]{1,20})(?=\s*[.!?]|\s*$)/g;
// Spelled with explicit case rather than the `i` flag: `i` would also make
// the NAME group match a lowercase word, and "thanks for calling" would read
// "for" as the name.
const VOCATIVE_AFTER_OPENER =
  /\b([Tt]hanks|[Tt]hank you|[Hh]i|[Hh]ello|[Hh]ey|[Oo]kay|[Oo]k|[Aa]lright|[Aa]ll right|[Gg]ot it|[Ss]ure|[Pp]erfect|[Bb]ye|[Gg]oodbye|[Tt]ake care)\s+([A-Z][a-z'’-]{1,20})\b/g;

/** Capitalised words that follow a vocative pattern but are never the caller's name. */
const NOT_A_VOCATIVE_NAME = new Set([
  "i",
  "im",
  "ill",
  "ive",
  "and",
  "but",
  "so",
  "the",
  "we",
  "you",
  "your",
  "it",
  "its",
  "is",
  "that",
  "this",
  "there",
  "then",
  "yes",
  "no",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
  "grace",
  // Words that can follow a comma, capitalised, without being anyone's name.
  "thanks",
  "thank",
  "sorry",
  "please",
  "bye",
  "goodbye",
  "okay",
  "ok",
  "sure",
  "right",
  "perfect",
  "great",
  "absolutely",
  "alright",
  "got",
]);

/**
 * A spelled-out run in Grace's own speech: "S-I-O-B-H-A-N". Three letters
 * minimum, so an initial ("J. R.") and ordinary hyphenated words
 * ("mother-in-law", "T-shirt") are not candidates.
 *
 * HYPHENS ONLY, deliberately. A space-separated alternative was tried first
 * and its own test caught it eating a letter out of the preceding word:
 * "That's A-N-A" matched from the "s" of "That's" and came back as
 * "That'A-N-N-A". Hyphens are the form the call notes hand over and the
 * form the prompt asks for, and a mangled word is a worse failure than a
 * missed spelling.
 *
 * 2026-10-22, second tester: "there are few instances where the csr still
 * guesses big names - i tried with mexican, caucasian and black names."
 * Asked to spell a name it only has by ear, the model supplies the letters
 * of the nearest name it knows. The call notes now hand it the real letters,
 * and this is the backstop for when it spells something else anyway — the
 * same "prompt wording has a ceiling, put a guard in the code" rule the
 * rest of this file is built on.
 *
 * Nothing is invented: the replacement letters are the caller's own name, so
 * the worst case is Grace spelling the name she was actually given.
 */
const SPELLED_RUN = /\b[A-Za-z](?:-[A-Za-z]){2,}\b/g;

const lettersOf = (run: string): string => run.replace(/[^a-z]/gi, "").toLowerCase();

const sameName = (a: string, b: string): boolean => {
  const left = a.toLowerCase().replace(/[^a-z]/g, "");
  const right = b.toLowerCase().replace(/[^a-z]/g, "");
  return left.length > 0 && (left === right || editDistanceAtMostOne(left, right));
};

/**
 * Client feedback (previous vendor's call, Oct 7): the CSR answered three
 * price questions with the same sentence, "Pricing depends on the job and
 * will be discussed before any work begins", word for word, and the caller
 * heard a recording. A statement Grace already made in one of her last few
 * replies is dropped instead of said again. Questions are never dropped
 * (re-asking an unanswered ZIP once is legitimate), and nor are short
 * sentences, where repeats are natural ("Okay.", "Is that right?").
 */
const REPEAT_MIN_WORDS = 5;
const REPEAT_SIMILARITY = 0.8;

function normalizedWords(sentence: string): string[] {
  return words(sentence)
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function similarity(a: readonly string[], b: readonly string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  let shared = 0;
  for (const word of setA) {
    if (setB.has(word)) {
      shared += 1;
    }
  }
  return shared / Math.max(setA.size, setB.size, 1);
}

function splitSentences(segment: string): string[] {
  return segment.match(/[^.!?]+(?:[.!?]+|$)\s*/g) ?? [segment];
}

/** Strips leading [cue] tags so the classifiers read only the words. */
function words(sentence: string): string {
  return sentence.replace(/\[[^\]]*\]/g, " ").trim();
}

function isQuestion(sentence: string): boolean {
  return /\?\s*$/.test(words(sentence));
}

/**
 * Call-centre phrasing the previous vendor's CSR used on every call ("May I
 * have your full name?"), which the prompt bans and the model still produces
 * now and then at low effort. Rewritten in place rather than dropped, since
 * the question itself is needed.
 */
const STIFF_PHRASES: ReadonlyArray<[RegExp, string]> = [
  [/\bMay I have\b/g, "Can I get"],
  [/\bmay I have\b/g, "can I get"],
  [/\bMay I get\b/g, "Can I get"],
  [/\bmay I get\b/g, "can I get"],
];

function plainSpoken(sentence: string): string {
  return STIFF_PHRASES.reduce(
    (text, [pattern, replacement]) => text.replace(pattern, replacement),
    sentence,
  );
}

/** Sentences past this word count are dropped (complete sentences only). */
const SOFT_WORD_LIMIT = 35;

export class OutputGuard {
  private readonly used = new Set<string>();
  private readonly recentStatements: string[][];
  private lastSentenceKey = "";
  private spokeAlready: boolean;
  private readonly questionsThisTurn: string[][];
  private readonly questionsLastTurn: string[][];
  private wordsSoFar = 0;
  readonly actions: GuardAction[] = [];

  /** `recentAgentReplies`: Grace's last few replies this call, oldest first. */
  /** `alreadySpokeThisTurn`: an earlier pass of this same turn already said something. */
  /** `callerName`: the first name the caller gave THIS call, when one is known — see NOT_A_VOCATIVE_NAME. */
  constructor(
    recentAgentReplies: readonly string[] = [],
    alreadySpokeThisTurn = false,
    alreadySaidThisTurn = "",
    private readonly callerName: string | null = null,
    private readonly houseNumber: string | null = null,
    /**
     * The caller asked Grace to say it again. The repeat suppression below
     * exists because a CSR who says the same sentence twice unprompted sounds
     * like a recording (client feedback, Oct 7) -- but when the repeat is
     * what was asked for, dropping it is dead air on top of a caller who
     * already could not hear. See isRepeatRequest.
     */
    private readonly repeatRequested = false,
    /** Every word of the name the caller gave, lowercase — see SPELLED_RUN. */
    private readonly nameWords: readonly string[] = [],
    /** This call's phone numbers, 10 digits each — see withTheRealNumber. */
    private readonly knownPhones: readonly string[] = [],
  ) {
    this.spokeAlready = alreadySpokeThisTurn;
    this.questionsThisTurn = splitSentences(alreadySaidThisTurn)
      .filter((sentence) => isQuestion(sentence))
      .map(normalizedWords);
    this.recentStatements = recentAgentReplies
      .flatMap((reply) => splitSentences(reply))
      .filter((sentence) => !isQuestion(sentence))
      .map(normalizedWords)
      .filter((sentenceWords) => sentenceWords.length >= REPEAT_MIN_WORDS);
    // 2026-10-14: a caller answered a DIFFERENT question than the one just
    // asked ("as soon as possible" to "is this the best callback number?"),
    // and Grace asked the SAME callback question again verbatim in her very
    // next reply — exactly the "come back to it later, not immediately"
    // prompt rule being missed. Only the immediately-preceding COMPLETED
    // turn is checked (not the fuller recentAgentReplies window used for
    // statements): re-asking something a few turns later, once the caller
    // has genuinely moved on without answering it, is legitimate and this
    // must not silence that.
    //
    // The caller (handle-turn.use-case.ts) appends `alreadySaidThisTurn`
    // as the LAST entry of `recentAgentReplies` itself, so when this is a
    // second pass of the SAME turn (alreadySpokeThisTurn), the genuinely
    // previous COMPLETED turn's reply is one further back — found live:
    // without this, the previous turn's question got shadowed by this
    // turn's own pass-1 acknowledgment and the repeat went uncaught.
    const previousReply = alreadySpokeThisTurn
      ? recentAgentReplies.at(-2)
      : recentAgentReplies.at(-1);
    this.questionsLastTurn = previousReply
      ? splitSentences(previousReply)
          .filter((sentence) => isQuestion(sentence))
          .map(normalizedWords)
      : [];
  }

  private repeatsRecentStatement(sentence: string): boolean {
    if (this.repeatRequested) {
      return false;
    }
    if (isQuestion(sentence)) {
      // 2026-10-14: "Is the water running right now...? Got it... Is the
      // water running right now...?" in one reply. A question already asked
      // earlier in this same turn, or verbatim in the turn right before this
      // one, is not asked again immediately.
      const asked = normalizedWords(sentence);
      if (asked.length < 4) {
        return false;
      }
      return (
        this.questionsThisTurn.some((earlier) => similarity(asked, earlier) >= REPEAT_SIMILARITY) ||
        this.questionsLastTurn.some((earlier) => similarity(asked, earlier) >= REPEAT_SIMILARITY)
      );
    }
    const current = normalizedWords(sentence);
    if (current.length < REPEAT_MIN_WORDS) {
      return false;
    }
    return this.recentStatements.some(
      (earlier) => similarity(current, earlier) >= REPEAT_SIMILARITY,
    );
  }

  /**
   * Drops a vocative name that is not the one the caller gave. See
   * VOCATIVE_TRAILING's own comment: the name comes out, nothing is
   * substituted, and only the two vocative forms are touched.
   */
  private withoutAStrangersName(sentence: string): string {
    if (!this.callerName) {
      return sentence;
    }
    const isWrong = (spoken: string): boolean =>
      !NOT_A_VOCATIVE_NAME.has(spoken.toLowerCase().replace(/[^a-z]/g, "")) &&
      !sameName(spoken, this.callerName!);
    let changed = false;
    const cleaned = sentence
      .replace(VOCATIVE_TRAILING, (whole, spoken: string) => {
        if (!isWrong(spoken)) {
          return whole;
        }
        changed = true;
        return "";
      })
      .replace(VOCATIVE_AFTER_OPENER, (whole, opener: string, spoken: string) => {
        if (!isWrong(spoken)) {
          return whole;
        }
        changed = true;
        return opener;
      });
    if (!changed) {
      return sentence;
    }
    this.actions.push("wrong_name");
    return cleaned.replace(/\s{2,}/g, " ").replace(/\s+([.!?,])/g, "$1");
  }

  /**
   * Replaces a spelled-out run that does not match any name the caller gave
   * with that caller's own letters. See SPELLED_RUN.
   *
   * Matched by POSITION: the first run in a reply is the first name, the
   * second is the second. That is the order Grace says them in, and it is
   * the only mapping available once the letters themselves are wrong.
   */
  private withTheRealSpelling(sentence: string): string {
    if (this.nameWords.length === 0) {
      return sentence;
    }
    let runIndex = -1;
    let changed = false;
    const cleaned = sentence.replace(SPELLED_RUN, (run) => {
      runIndex += 1;
      const spoken = lettersOf(run);
      // Already one of the caller's own names, in any position: leave it.
      if (this.nameWords.some((word) => sameName(spoken, word))) {
        return run;
      }
      const expected = this.nameWords[runIndex];
      if (!expected) {
        return run;
      }
      changed = true;
      return expected.toUpperCase().split("").join("-");
    });
    if (!changed) {
      return sentence;
    }
    this.actions.push("wrong_spelling");
    return cleaned;
  }

  /** Returns the text to speak for this segment; an empty string means say nothing. */
  apply(segment: string): string {
    const out: string[] = [];
    let slow = false;
    for (const sentence of splitSentences(segment)) {
      const plain = words(sentence);
      if (!plain) {
        out.push(sentence);
        continue;
      }
      if (META_LEAK.test(plain) || REASONING_LEAK.test(plain)) {
        this.actions.push("meta_leak");
        continue;
      }
      // Back-to-back identical sentences, however short ("Good luck with it.
      // Good luck with it."), QA 2026-10-13.
      const key = normalizedWords(sentence).join(" ");
      if (key && key === this.lastSentenceKey) {
        this.actions.push("repeated_statement");
        continue;
      }
      this.lastSentenceKey = key;
      // QA 2026-10-13: a pass before a tool call and the pass after it were
      // glued with a bare "Got it." in the middle, pushing replies past 35
      // words. An acknowledgment adds nothing once something was already said.
      if (
        PURE_ACK.test(plain) &&
        (this.spokeAlready || out.some((part) => words(part).length > 0))
      ) {
        continue;
      }
      if (this.repeatsRecentStatement(sentence)) {
        this.actions.push("repeated_statement");
        continue;
      }
      // Drop complete sentences past the soft word limit. Never cuts mid-
      // sentence, and the first sentence always gets through.
      const sentenceWordCount = plain.split(/\s+/).filter(Boolean).length;
      if (this.wordsSoFar > 0 && this.wordsSoFar + sentenceWordCount > SOFT_WORD_LIMIT) {
        this.actions.push("word_limit");
        continue;
      }
      if (!isQuestion(sentence) && TIME_WORD.test(plain)) {
        const hard = HARD_PROMISE.test(plain);
        const soft = SOFT_PROMISE.test(plain) && !HEDGE.test(plain);
        if (hard || soft) {
          this.actions.push("timing_promise");
          const replacement = /\b(works|is fine|sounds good|is good|will work)\b/i.test(plain)
            ? SAFE_PREFERENCE_LINE
            : SAFE_TIMING_LINE;
          if (!this.used.has(replacement)) {
            this.used.add(replacement);
            out.push(`${replacement} `);
          }
          continue;
        }
      }
      if (!isQuestion(sentence) && CAUSE_CLAIM.test(plain)) {
        this.actions.push("cause_claim");
        if (!this.used.has(SAFE_CAUSE_LINE)) {
          this.used.add(SAFE_CAUSE_LINE);
          out.push(`${SAFE_CAUSE_LINE} `);
        }
        continue;
      }
      if (CHANGE_CLAIM.test(plain) && !CHANGE_HEDGE.test(plain)) {
        this.actions.push("change_claim");
        if (!this.used.has(SAFE_CHANGE_LINE)) {
          this.used.add(SAFE_CHANGE_LINE);
          out.push(`${SAFE_CHANGE_LINE} `);
        }
        continue;
      }
      if (
        STREET_READBACK.test(plain) ||
        DIGIT_READBACK.test(plain) ||
        (this.houseNumber !== null && mentionsHouseNumber(plain, this.houseNumber))
      ) {
        slow = true;
      }
      if (isQuestion(sentence)) {
        this.questionsThisTurn.push(normalizedWords(sentence));
      }
      this.wordsSoFar += sentenceWordCount;
      let kept = isQuestion(sentence)
        ? plainSpoken(sentence)
        : plainSpoken(sentence).replace(OWN_TODAY, "right away");
      kept = this.withoutAStrangersName(kept);
      kept = this.withTheRealSpelling(kept);
      const numbered = withTheRealNumber(kept, this.knownPhones);
      if (numbered !== kept) {
        this.actions.push("wrong_phone_readback");
        kept = numbered;
        slow = true;
      }
      if (slow) {
        kept = hyphenateHouseNumber(kept, this.houseNumber);
      }
      out.push(kept);
    }
    // Keep the segment's own edge whitespace: segments are streamed one after
    // another, and a lost leading space would glue two spoken words together.
    const leading = segment.match(/^\s*/)?.[0] ?? "";
    const trailing = segment.match(/\s*$/)?.[0] ?? "";
    let body = out.join("").trim();
    if (!body) {
      return "";
    }
    this.spokeAlready = true;
    // Consolidate delivery cues: the model sometimes puts [slowly] on every
    // sentence, producing robotic stacking. Strip all internal cues and let
    // the guard add one at the front when a readback is present.
    body = body.replace(/\[slowly\]\s*/gi, "").trim();
    if (!body) {
      return "";
    }
    if (slow && !/^\[slowly\]/i.test(body)) {
      this.actions.push("slow_readback");
      body = `[slowly] ${body}`;
    }
    return `${leading}${body}${trailing}`;
  }
}
