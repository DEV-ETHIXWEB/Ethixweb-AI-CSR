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

const HARD_EMERGENCY =
  /\b(burst|flood(?:ing|ed)?|gas leak|smell(?:s)? (?:like )?gas|gas smell|sewage|sewer back|no water|water everywhere|pouring|gushing|spraying)\b/i;
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

export const NUMBER_ASKED =
  /\b(best number|number (to|we can|i can) (reach|call)|reach you (at|on)|call you (at|on|back)|(right|correct|best|good|usable) number|call ?back number|contact number|phone number|number (you'?re|you are) calling from|number on (this|the) (call|line)|this number)\b/i;

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
    return hasStreetArg(address) ? null : ADDRESS_NOT_PASSED_ERROR;
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
export function callbackNumberNote(callerAni: string | null | undefined): string {
  const digits = (callerAni ?? "").replace(/\D/g, "").slice(-10);
  const spoken =
    digits.length === 10
      ? `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`
      : "the number they are calling from";
  return (
    "[System note: you have their address but have not confirmed a callback number. " +
    `Your reply asks only one question: whether ${spoken} is the best number to reach them, ` +
    "reading it digit by digit, without the +1.]"
  );
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
  // QA 2026-10-13: the note pushed Grace straight to the callback question
  // and the address was never read back. It waits until she has said the
  // house number back to the caller.
  const houseNumber = notes.street?.split(" ")[0];
  if (
    houseNumber &&
    !args.agentTexts.some((text) =>
      collapseSpokenDigits(text).replace(/[\s-]/g, "").includes(houseNumber),
    )
  ) {
    return false;
  }
  return !args.agentTexts.some((text) => NUMBER_ASKED.test(text));
}
