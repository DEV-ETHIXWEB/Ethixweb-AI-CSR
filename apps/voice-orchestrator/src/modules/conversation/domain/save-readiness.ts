import { extractStreet } from "./address-check";
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

export const ADDRESS_NEEDED_ERROR = {
  error: "address_needed",
  detail:
    "Do not save yet. You do not have the caller's street address (house number and street name). Ask for it in one short question and read it back. Then save it, passing the address in this same call.",
} as const;

export const ADDRESS_NOT_PASSED_ERROR = {
  error: "address_not_passed",
  detail:
    "The caller already gave a street address. Call this again and include it in the address field (street, city, state, zip). It cannot be added later.",
} as const;

export const NUMBER_ASKED =
  /\b(best number|number (to|we can|i can) (reach|call)|reach you (at|on)|call you (at|on|back)|(right|correct|best|good|usable) number|call ?back number|contact number|phone number|number (you'?re|you are) calling from|number on (this|the) (call|line)|this number)\b/i;

export const PHONE_NOT_CONFIRMED_ERROR = {
  error: "callback_number_not_confirmed",
  detail:
    "Do not save yet. You have not confirmed the callback number. Ask once whether the number they are calling from is the best one to reach them, reading it back slowly, or take a different one. Then save it.",
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
    detail: `The caller gave the number ${spoken.slice(0, 3)}-${spoken.slice(3, 6)}-${spoken.slice(6)}. Use exactly that number as the phone (E.164, +1${spoken}), not the caller ID, and read it back to them.`,
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

function addressBlockedReason({ callerTexts, agentTexts, address }: Args) {
  const callerText = callerTexts.slice(-12).join(" . ");
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

export const CALLBACK_NUMBER_NOTE =
  "[System note: you have their address but have not yet confirmed the callback number. " +
  "In THIS reply the ONLY question you ask is whether the number they are calling from " +
  "(read it back slowly, digit by digit) is the best one to reach them. Ask nothing else this turn.]";

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
  if (extractStreet(args.callerTexts.slice(-12).join(" . ")) === null) {
    return false;
  }
  if (spokenPhoneDigits(args.callerTexts) !== null) {
    return false;
  }
  return !args.agentTexts.some((text) => NUMBER_ASKED.test(text));
}
