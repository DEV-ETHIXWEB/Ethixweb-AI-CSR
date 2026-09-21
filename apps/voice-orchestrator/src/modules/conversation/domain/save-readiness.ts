import { extractStreet } from "./address-check";

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

interface Args {
  callerTexts: readonly string[];
  agentTexts: readonly string[];
  address: unknown;
}

const hasStreetArg = (address: unknown): boolean =>
  typeof address === "object" &&
  address !== null &&
  typeof (address as Record<string, unknown>)["street"] === "string" &&
  ((address as Record<string, unknown>)["street"] as string).trim().length > 0;

/** The error to hand back to the model, or null when saving may go ahead. */
export function saveBlockedReason({ callerTexts, agentTexts, address }: Args) {
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
