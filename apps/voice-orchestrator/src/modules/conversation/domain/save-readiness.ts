import { extractStreet } from "./address-check";
import { buildCallNotes } from "./call-notes";
import { collapseSpokenDigits } from "./service-area";

/**
 * Client feedback: requests were submitted without a clear name and address
 * confirmation. The tool description used to tell the model to save with
 * whatever it had, and createCustomer is the only place an address can be
 * stored, so an early save meant the address was lost for good. This is the
 * deterministic gate: a customer is only created once the caller has given a
 * street address, with three escape hatches so nobody is ever stuck:
 * a real emergency (speed wins), a caller who declined to give one, and a
 * caller who was asked twice already.
 */

// `overflow` added 2026-10-22, from a tester's own words: "I mentioned that
// there's an active overflow still and asked that can someone come today but
// it just gives a generic response". Every other list in the codebase that
// decides urgency already carries it (looksEmergencyAdjacent's own triggers,
// the prompt's active-problem rule); this one did not, so an active overflow
// was the one phrasing that did NOT relax the save gate for speed.
const HARD_EMERGENCY =
  /\b(burst|flood(?:ing|ed)?|overflow(?:s|ed|ing)?|gas leak|smell(?:s)? (?:like )?gas|gas smell|sewage|sewer back|no water|water everywhere|pouring|gushing|spraying|burning smell|smell(?:s|ing)? (?:something )?(?:like )?(?:it'?s )?burning|electrical smell|smoke coming|sparking)\b/i;
const DECLINED_ADDRESS =
  /\b(don'?t|do not|won'?t|rather not|prefer not|not comfortable|no need|skip)\b.{0,40}\b(address|give|say|share|location)\b|\bno address\b/i;
const ASKED_FOR_ADDRESS =
  /\baddress\b[^?]*\?|what street|house number|where (are you|is it) located/i;

/** True when the caller described a clear emergency, where speed beats a complete record. */
export function isHardEmergency(callerTexts: readonly string[]): boolean {
  return callerTexts.some((text) => HARD_EMERGENCY.test(text));
}

export const LEAD_NEEDS_CUSTOMER_DETAILS_ERROR = {
  error: "customer_details_not_saved",
  detail:
    "Not saved yet. The record on file for this number has no real name or service address. First get the caller's name, the street address and the callback number, then call createCustomer (it updates the existing record), then createLead. Everything the caller already told you is still valid: do not ask for it again.",
} as const;

export const ADDRESS_NEEDED_ERROR = {
  error: "address_needed",
  detail:
    "Do not save yet. You do not have the caller's street address (house number and street name). Ask for it in one short question and read it back. Then save it, passing the address in this same call. Everything else the caller already gave you is still valid: do not ask for it again.",
} as const;

export const ADDRESS_NOT_PASSED_ERROR = {
  error: "address_not_passed",
  detail:
    "The caller already gave a street address. Call this again and include it in the address field (street, city, state, zip). It cannot be added later. Do not ask the caller for it again.",
} as const;

export const ADDRESS_NOT_READ_BACK_ERROR = {
  error: "address_not_confirmed",
  detail:
    "Do not save yet. You have the caller's address but have not read it back to them. Read the full address back once (house number, street, city, ZIP) and ask if it is right. Then call this again with the same address. Everything else the caller already gave you is still valid: do not ask for it again.",
} as const;

/**
 * 2026-10-22 tester call: "I didn't give any issue or problem at all, it
 * just took the name and address and said you are all set, without even
 * asking the problem."
 *
 * Every other part of a complete request had a deterministic gate; the
 * reason for the call had none. `problem_summary` is a required tool
 * argument, so the model can and did satisfy it with something it was
 * never told, and a lead with an invented problem is worse than no lead:
 * the team dispatches on it.
 *
 * Deliberately LIBERAL — anything that reads as a reason to call a plumber
 * counts, including a complaint or an appointment change, which are real
 * call reasons with no fixture in them. A false "described" costs nothing
 * (the gate simply does not fire); a false "not described" would block an
 * honest save, which is the regression this must not cause. The escape
 * hatches below exist for the same reason.
 */
const PROBLEM_WORDS =
  /\b(leak(s|ed|ing|age)?|clog(s|ged|ging)?|block(ed|age)|back(ed|ing)? up|backup|overflow(s|ed|ing)?|burst|broke(n)?|crack(s|ed)?|drip(s|ping)?|running|won'?t (drain|flush|stop|turn|work|shut)|no (hot )?water|low (water )?pressure|flood(s|ed|ing)?|smell(s|ing)?|stuck|jam(med)?|noise|not working|stopped working|replace(d|ment)?|install(ed|ation)?|repair(s|ed)?|fix(ed|ing)?|service|maintenance|inspect(ion)?|estimate|quote|re-?pipe|snake|pump out)\b|\b(water heater|hot water|pipe|pipes|plumbing|drain|toilet|sink|faucet|tap|shower|bathtub|tub|disposal|garbage disposal|sewer|sewage|septic|valve|spigot|hose bib|sprinkler|boiler|radiator|softener|sump|main line|gas line|washer|dishwasher)\b|\b(problem|issue|trouble|emergency|something('s| is)? wrong|need (some )?help|help with)\b|\b(appointment|reschedul(e|ing)|cancel(led|lation)?|missed|no.?show|complain(t|ing)?|came out|technician came)\b/i;

const PROBLEM_ASKED =
  /\bwhat'?s (going on|the (problem|issue|trouble)|happening)\b|\bwhat (can|may) i help\b|\bhow can i help\b|\bwhat happened\b|\bgoing on with\b|\bwhat seems to be\b|\bwhat kind of (problem|issue|trouble)\b|\btell me (what|about)\b|\bwhat (are|is) you (calling|needing)\b|\bwhat do you need\b/i;

const DECLINED_PROBLEM =
  /\b(don'?t know|not sure|no idea|can'?t say|rather not|just (want|need) (someone|a) (to come|call|quote|estimate)|just calling (about|for))\b/i;

/** True when the caller has said anything that reads as a reason for the call. */
export function problemDescribed(callerTexts: readonly string[]): boolean {
  return callerTexts.some((text) => PROBLEM_WORDS.test(text));
}

export const PROBLEM_NEEDED_ERROR = {
  error: "problem_not_described",
  detail:
    "Do not save yet. The caller has not told you what is wrong, and problem_summary must be their words, never your own. Ask once, in one short question, what is going on. Everything else they already gave you (name, address, number) is still valid: do not ask for any of it again.",
} as const;

/**
 * The error to hand back when a lead is being saved with no reason for the
 * call, or null when the save may go ahead. Escape hatches, in order: a
 * clear emergency (speed wins, same rule as the address gate), a caller who
 * cannot or will not say, and a caller who has already been asked twice.
 */
export function leadProblemBlockedReason(args: {
  callerTexts: readonly string[];
  agentTexts: readonly string[];
}) {
  if (problemDescribed(args.callerTexts)) {
    return null;
  }
  if (isHardEmergency(args.callerTexts)) {
    return null;
  }
  if (args.callerTexts.some((text) => DECLINED_PROBLEM.test(text))) {
    return null;
  }
  if (args.agentTexts.filter((text) => PROBLEM_ASKED.test(text)).length >= 2) {
    return null;
  }
  return PROBLEM_NEEDED_ERROR;
}

export const NUMBER_ASKED =
  /\b(best number|number (to|we can|i can) (reach|call)|reach you (at|on)|call you (at|on|back)|(right|correct|best|good|usable) number|call ?back number|contact number|phone number|number (you'?re|you are) calling from|number on (this|the) (call|line)|this number|(best|good|right) one to (reach|call) you|number (we'?re|we are|you'?re|you are) (talking|speaking) on|number (you|they) called (from|on)|(best|good|right) way to (reach|contact|call) you|different number|number (you'?d|you would|i should|we should) (like me to )?use)\b/i;

export const PHONE_NOT_CONFIRMED_ERROR = {
  error: "callback_number_not_confirmed",
  detail:
    "Do not save yet. You have not confirmed the callback number. Ask once whether the number they are calling from is the best one to reach them, reading it back slowly, or take a different one. Then save it. Everything else the caller already gave you is still valid: do not ask for it again.",
} as const;

/** The last 10-digit US phone number the caller SAID (spoken digits included), or null. */
export function spokenPhoneDigits(callerTexts: readonly string[]): string | null {
  for (let i = callerTexts.length - 1; i >= 0; i -= 1) {
    const collapsed = collapseSpokenDigits(callerTexts[i] ?? "");
    const match = collapsed.match(/(?:\+?1[\s.-]*)?\(?(\d{3})\)?[\s.-]*(\d{3})[\s.-]*(\d{4})\b/);
    if (match) {
      return `${match[1]}${match[2]}${match[3]}`;
    }
  }
  return null;
}

export function phoneMismatchError(spoken: string) {
  return {
    error: "phone_differs_from_what_caller_said",
    detail: `The caller gave the number ${spoken.slice(0, 3)}-${spoken.slice(3, 6)}-${spoken.slice(6)}. Use exactly that number as the phone (E.164, +1${spoken}), not the caller ID, and read it back to them. Do not ask for anything else again.`,
  } as const;
}

/** The agent's text carries these digits in order, however they were written ("2-0-6...", "206 555..."). */
function saysDigits(text: string, digits: string): boolean {
  return text
    .replace(/\boh\b/gi, "0")
    .replace(/\D/g, "")
    .includes(digits);
}

export function newNumberNotReadBackError(spoken: string) {
  return {
    error: "new_callback_number_not_read_back",
    detail: `Do not save yet. Read the number they just gave back to them, digit by digit, without the +1: ${spoken.split("").join("-")}, and ask if that is right. Then save it as the phone. Do not ask for anything else again.`,
  } as const;
}

interface Args {
  callerTexts: readonly string[];
  agentTexts: readonly string[];
  address: unknown;
  phone?: unknown;
}

const hasStreetArg = (address: unknown): boolean =>
  typeof address === "object" &&
  address !== null &&
  typeof (address as Record<string, unknown>)["street"] === "string" &&
  ((address as Record<string, unknown>)["street"] as string).trim().length > 0;

/** The error to hand back to the model, or null when saving may go ahead. */
export function saveBlockedReason(args: Args) {
  const addressProblem = addressBlockedReason(args);
  if (addressProblem) {
    return addressProblem;
  }
  const { callerTexts, agentTexts, phone } = args;
  // A number the caller actually gave always wins over caller ID, in an
  // emergency too: a wrong callback number is unrecoverable.
  const spoken = spokenPhoneDigits(callerTexts);
  if (spoken !== null && typeof phone === "string") {
    const passed = phone.replace(/\D/g, "").slice(-10);
    if (passed !== spoken) {
      return phoneMismatchError(spoken);
    }
  }
  // QA 2026-10-23 (feedback-15): "please call me on 206 555 0147 instead",
  // and the request was saved and closed without the new number ever being
  // said back. A number the caller gives is read back before it is saved,
  // the same as the one on caller ID; a wrong one cannot be recovered.
  if (spoken !== null && !agentTexts.some((text) => saysDigits(text, spoken))) {
    return newNumberNotReadBackError(spoken);
  }
  if (callerTexts.some((text) => HARD_EMERGENCY.test(text))) {
    return null;
  }
  if (spoken === null && !agentTexts.some((text) => NUMBER_ASKED.test(text))) {
    return PHONE_NOT_CONFIRMED_ERROR;
  }
  return null;
}

/**
 * 2026-10-14 tester call: "fifty three one two, one hundred fifty six drive
 * northeast" is not parsed as a street (only single spoken digits are
 * collapsed), so a confirmed address was refused as "address_needed" and
 * Grace asked the caller to confirm it a second time. An address Grace has
 * already read back to the caller, passed in the save, is accepted.
 */
function readBackByAgent(address: unknown, agentTexts: readonly string[]): boolean {
  if (!hasStreetArg(address)) {
    return false;
  }
  const street = (address as Record<string, string>)["street"] ?? "";
  const houseNumber = street.match(/\d{1,6}/)?.[0];
  if (!houseNumber) {
    return false;
  }
  return agentTexts.some((text) =>
    collapseSpokenDigits(text).replace(/[\s-]/g, "").includes(houseNumber),
  );
}

function addressBlockedReason({ callerTexts, agentTexts, address }: Args) {
  if (readBackByAgent(address, agentTexts)) {
    return null;
  }
  // The whole call, not a recent window: on a long call an address given
  // early read as "never given", and the refusal sent Grace back to re-ask it.
  const callerText = callerTexts.join(" . ");
  const streetGiven = extractStreet(callerText) !== null;
  if (streetGiven) {
    if (!hasStreetArg(address)) {
      return ADDRESS_NOT_PASSED_ERROR;
    }
    if (!callerTexts.some((text) => HARD_EMERGENCY.test(text))) {
      return ADDRESS_NOT_READ_BACK_ERROR;
    }
    return null;
  }
  if (callerTexts.some((text) => HARD_EMERGENCY.test(text))) {
    return null;
  }
  if (callerTexts.some((text) => DECLINED_ADDRESS.test(text))) {
    return null;
  }
  const timesAsked = agentTexts.filter((text) => ASKED_FOR_ADDRESS.test(text)).length;
  if (timesAsked >= 3) {
    return null;
  }
  return ADDRESS_NEEDED_ERROR;
}

const NAME_ASKED =
  /\b(your name|who am i speaking|what'?s your name|can i (get|have|grab) your name|and your name)\b/i;

/**
 * The callback question, with the caller-ID number already in spoken form.
 * QA 2026-10-13: given only the raw +1 number, the model read it as "plus
 * 2-0-6..." and corrected itself mid-sentence; and the old wording ("ask
 * nothing else this turn") was echoed aloud as "you asked me only one thing
 * this turn".
 */
export function callbackNumberNote(
  callerAni: string | null | undefined,
  name?: { spelled: readonly string[] | null; stated: string | null },
  address?: { street: string | null; zip: string | null },
  agentTexts: readonly string[] = [],
): string {
  const digits = (callerAni ?? "").replace(/\D/g, "").slice(-10);
  const spoken =
    digits.length === 10
      ? `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`
      : "the number they are calling from";
  // 2026-10-22, Akash: "instead of asking in between to recheck the details,
  // can he just confirm that details at the end of the call?" The number was
  // its own turn, and the name's letters were read back in the middle of the
  // intake — two interruptions where one line at the end does the same work.
  // The address keeps its own read-back in place: it is the longest item, it
  // needs the ZIP with it, and it is the one a wrong value sends a truck to.
  // 2026-10-22, client call: "the system confirmed my address more than
  // three times ... it should only reconfirm it once, at the end of the
  // call, just before ending the conversation." So the address joins this
  // one closing confirmation instead of being read back when it is taken.
  const spokenAddress = addressForConfirmation(address);
  const letters = nameLetters(name);
  // 2026-10-23, client decision: two short questions, not one line. A caller
  // said of the one-line version "how can I understand if you speak the
  // address and number at once". Name and address first; once Grace has
  // read those back, the number on its own (the branch just below).
  if (letters && !nameAndAddressReadBack(agentTexts, name, address)) {
    return (
      "[You now have everything you need. Confirm it in TWO short questions, one per turn, and " +
      "this turn is ONLY the first: read back the name, spelled out " +
      `(${letters})${spokenAddress}, and ask if that is right. Say every letter and digit one at ` +
      "a time. Do not mention the phone number yet; that is the next question. This is the ONLY " +
      "time the name and address are confirmed. Ask nothing else.]"
    );
  }
  return (
    "[The caller has confirmed their name and address. Your whole reply confirms ONE thing: " +
    `whether ${spoken} is the best number to reach them, read digit by digit, without the +1. ` +
    "Then save. Ask nothing else.]"
  );
}

/**
 * Grace has already read the name and the address back: one reply of hers
 * carries both the caller's first name and the house number (in any form,
 * "1748" or our own "1-7-4-8").
 */
function nameAndAddressReadBack(
  agentTexts: readonly string[],
  name?: { spelled: readonly string[] | null; stated: string | null },
  address?: { street: string | null; zip: string | null },
): boolean {
  const first = (name?.spelled?.[0] ?? name?.stated?.split(/\s+/)[0] ?? "").toLowerCase();
  if (!first) {
    return false;
  }
  const house = address?.street?.match(/^\d{1,6}/)?.[0] ?? "";
  // No street (declined, or an emergency saved without one): the name's
  // spelling read back is the whole of the first question.
  const spelled = first.toUpperCase().split("").join("-");
  return agentTexts.some((text) => {
    if (!house) {
      return text.includes(spelled);
    }
    const lower = text.toLowerCase();
    const digits = lower.replace(/\boh\b/g, "0").replace(/[\s-]/g, "");
    return lower.includes(first) && digits.includes(house);
  });
}

/** The address as it should be spoken in the closing confirmation, or "" when there is none. */
function addressForConfirmation(address?: { street: string | null; zip: string | null }): string {
  if (!address?.street) {
    return "";
  }
  const words = address.street.split(" ");
  const house = words[0] ?? "";
  const spokenStreet = /^\d{3,6}$/.test(house)
    ? [
        house
          .split("")
          .map((digit) => (digit === "0" ? "oh" : digit))
          .join("-"),
        ...words.slice(1),
      ].join(" ")
    : address.street;
  const spokenZip = address.zip
    ? `, ZIP ${address.zip
        .split("")
        .map((digit) => (digit === "0" ? "oh" : digit))
        .join("-")}`
    : "";
  return `, the address (${spokenStreet}${spokenZip})`;
}

/** The caller's name as spoken letters for the closing confirmation, or null when there is no name to confirm. */
function nameLetters(name?: {
  spelled: readonly string[] | null;
  stated: string | null;
}): string | null {
  const words = name?.spelled ?? name?.stated?.split(/\s+/).filter(Boolean) ?? null;
  if (!words || words.length === 0) {
    return null;
  }
  return words
    .map((word) =>
      word
        .replace(/[^a-z]/gi, "")
        .toUpperCase()
        .split("")
        .join("-"),
    )
    .filter((word) => word.length > 0)
    .join(", ");
}

/**
 * True when the address is in, nobody has asked about or been given a callback
 * number, and nothing is saved yet. Same reasoning as the name nudge: a prompt
 * rule alone let the question be crammed into a reply with another question.
 */
export function shouldNudgeForCallbackNumber(args: {
  callerTexts: readonly string[];
  agentTexts: readonly string[];
  customerId?: string | null | undefined;
  leadEverAttempted?: boolean | undefined;
}): boolean {
  if (args.customerId || args.leadEverAttempted) {
    return false;
  }
  if (args.callerTexts.some((text) => HARD_EMERGENCY.test(text))) {
    return false;
  }
  if (extractStreet(args.callerTexts.join(" . ")) === null) {
    return false;
  }
  if (spokenPhoneDigits(args.callerTexts) !== null) {
    return false;
  }
  // QA 2026-10-13: a caller who opened with their address got this note on
  // their very first turn, before Grace even knew the problem or the name, and
  // she spoke the note's own logic aloud. The order is problem, name, address,
  // callback, so the callback question waits until a name has been given.
  const notes = buildCallNotes(args.callerTexts);
  const nameAsked = args.agentTexts.some((text) => NAME_ASKED.test(text));
  if (!notes.statedName && !notes.spelledName && !nameAsked) {
    return false;
  }
  // See zipMissingNote: the closing confirmation waits for the ZIP.
  if (zipStillNeeded(args.callerTexts, args.agentTexts, notes.zip)) {
    return false;
  }
  // The QA 2026-10-13 version of this waited until Grace had already said
  // the house number back, because the address had to be read back before
  // the save. That precondition is gone with the mid-call readback it was
  // waiting on (2026-10-22): this note now DOES the address readback, so
  // waiting for one would deadlock and the call would never reach a
  // confirmation at all.
  return !args.agentTexts.some((text) => NUMBER_ASKED.test(text));
}

/** Grace asking for the ZIP code. */
const ZIP_ASKED = /\b(zip|zip code|postal code)\b/i;
/** The caller saying they do not have it. */
const ZIP_UNKNOWN =
  /\b(don'?t|do not|can'?t|cannot) (know|remember|recall)\b[^.?!]{0,25}\bzip\b|\bzip\b[^.?!]{0,25}\b(don'?t|do not|can'?t) (know|remember)\b|\bno idea\b/i;
// Once: the prompt's own rule is to ask for the ZIP once and accept the city
// if they do not know it. Twice made a real-model QA caller who answered
// "in Seattle" get asked again (2026-10-23, scenario feel-05).
const MAX_ZIP_ASKS = 1;

function zipStillNeeded(
  callerTexts: readonly string[],
  agentTexts: readonly string[],
  zip: string | null,
): boolean {
  if (zip !== null || extractStreet(callerTexts.join(" . ")) === null) {
    return false;
  }
  // The notes only take a 98/99 ZIP on its own (see lastZip); for "has the
  // caller given a ZIP at all", any five-digit number other than a house
  // number counts, so an out-of-area caller is never asked again for one.
  const fiveDigitRuns = callerTexts.flatMap((text) =>
    [
      ...collapseSpokenDigits(text).matchAll(
        /(?<!\d)(\d{5})(?!\d)(?!\s+[a-z]+\s+(?:st|street|ave|avenue|rd|road|way|blvd|dr|drive|ln|lane|pl|place|ct|court)\b)/g,
      ),
    ].map((match) => match[1]),
  );
  if (fiveDigitRuns.length > 0) {
    return false;
  }
  if (callerTexts.some((text) => ZIP_UNKNOWN.test(text))) {
    return false;
  }
  return agentTexts.filter((text) => ZIP_ASKED.test(text)).length < MAX_ZIP_ASKS;
}

/**
 * 2026-10-23 client call: Grace read back the caller's whole address with
 * "ZIP unknown" in it, while the caller was still giving it. The closing
 * confirmation fired on the street alone, and the note that asks for a
 * missing ZIP only fires on a turn whose own words carry a whole street
 * ("westlake avenue unit four" has no house number, so it did not). So the
 * ZIP is now asked for, on its own, before the closing confirmation, once,
 * and not when the caller says they do not know it.
 */
export function zipMissingNote(args: {
  callerTexts: readonly string[];
  agentTexts: readonly string[];
}): string | null {
  const notes = buildCallNotes(args.callerTexts);
  if (!notes.statedName && !notes.spelledName) {
    return null;
  }
  if (!zipStillNeeded(args.callerTexts, args.agentTexts, notes.zip)) {
    return null;
  }
  return "[You have their street but not the ZIP code. Your whole reply: ask for the ZIP code. Do not read anything back yet. Ask nothing else.]";
}
