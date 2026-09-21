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
  /\b(per (the|my) (instructions?|prompt|rules?|guidelines?)|according to (the|my) (instructions?|prompt|guidelines?)|the (caller|customer) (has|had|already|just|is|said|wants|signed)|already said goodbye|ended the call|the call is over|system note|as an ai\b|my (system )?prompt|no further (response|action) (is )?(needed|required|necessary))/i;

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
  "meta_leak" | "timing_promise" | "change_claim" | "cause_claim" | "slow_readback";

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

export class OutputGuard {
  private readonly used = new Set<string>();
  readonly actions: GuardAction[] = [];

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
      if (META_LEAK.test(plain)) {
        this.actions.push("meta_leak");
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
      out.push(sentence);
    }
    // Keep the segment's own edge whitespace: segments are streamed one after
    // another, and a lost leading space would glue two spoken words together.
    const leading = segment.match(/^\s*/)?.[0] ?? "";
    const trailing = segment.match(/\s*$/)?.[0] ?? "";
    let body = out.join("").trim();
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
