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
const DIGIT_READBACK = /\b(?:\d[\s-]){4,}\d\b|\b\d{5}\b|\b\d{3}[-. ]\d{3}[-. ]\d{4}\b/;

export type GuardAction =
  | "meta_leak"
  | "timing_promise"
  | "change_claim"
  | "cause_claim"
  | "slow_readback"
  | "repeated_statement";

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

export class OutputGuard {
  private readonly used = new Set<string>();
  private readonly recentStatements: string[][];
  private lastSentenceKey = "";
  private spokeAlready: boolean;
  private readonly questionsThisTurn: string[][];
  readonly actions: GuardAction[] = [];

  /** `recentAgentReplies`: Grace's last few replies this call, oldest first. */
  /** `alreadySpokeThisTurn`: an earlier pass of this same turn already said something. */
  constructor(
    recentAgentReplies: readonly string[] = [],
    alreadySpokeThisTurn = false,
    alreadySaidThisTurn = "",
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
  }

  private repeatsRecentStatement(sentence: string): boolean {
    if (isQuestion(sentence)) {
      // 2026-10-14: "Is the water running right now...? Got it... Is the
      // water running right now...?" in one reply. A question already asked
      // earlier in this same turn is not asked again.
      const asked = normalizedWords(sentence);
      return (
        asked.length >= 4 &&
        this.questionsThisTurn.some((earlier) => similarity(asked, earlier) >= REPEAT_SIMILARITY)
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
      if (STREET_READBACK.test(plain) || DIGIT_READBACK.test(plain)) {
        slow = true;
      }
      if (isQuestion(sentence)) {
        this.questionsThisTurn.push(normalizedWords(sentence));
      }
      out.push(
        isQuestion(sentence)
          ? plainSpoken(sentence)
          : plainSpoken(sentence).replace(OWN_TODAY, "right away"),
      );
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
    if (slow && !/^\[slowly\]/i.test(body)) {
      this.actions.push("slow_readback");
      body = `[slowly] ${body}`;
    }
    return `${leading}${body}${trailing}`;
  }
}
