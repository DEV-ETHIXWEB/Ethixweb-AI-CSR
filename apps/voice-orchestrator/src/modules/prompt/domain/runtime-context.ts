/**
 * docs/03 §4's RUNTIME CONTEXT layer — computed fresh per call, never
 * cached across calls. `businessHours`/`existingCustomerMatch` are
 * `null` when the upstream lookup is unavailable/degraded (e.g. the
 * future `getBusinessHours`/`searchCustomer` tool results aren't in yet
 * at prompt-assembly time) — rendered as an honest "unknown" in the
 * prompt text rather than a guessed default, so the model doesn't state
 * something false to the caller.
 */
export interface RuntimeContext {
  /**
   * The business the caller actually dialled, so the AI can name it.
   * Null when core-api could not supply it, which renders as a neutral
   * line rather than a placeholder: before this field existed the prompt
   * carried a literal "[the business]" example that the model spoke out
   * loud, and both agent-profile providers hardcoded "the office".
   */
  businessName: string | null;
  currentTimeIso: string;
  timezone: string;
  businessHours: { isOpen: boolean; opensAt?: string; isHoliday: boolean } | null;
  callerAni: string;
  existingCustomerMatch: {
    found: boolean;
    name?: string;
    customerId?: string;
    /** The stored service address as one spoken line, or null when none is on file. */
    address?: string | null;
  } | null;
}

/** A stored address JSON ({street, city, state, zip}) as one line, or null when there is no street. */
export function formatStoredAddress(address: Record<string, unknown> | null | undefined): string | null {
  if (!address) {
    return null;
  }
  const part = (key: string): string =>
    typeof address[key] === "string" ? address[key].trim() : "";
  const street = part("street") || part("line1");
  if (!street) {
    return null;
  }
  return [street, part("city"), [part("state"), part("zip")].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
}

export function formatRuntimeContext(context: RuntimeContext): string {
  const lines = [
    context.businessName
      ? `Business: ${context.businessName}. This is the company you work for and the name you give when a caller asks who they have reached.`
      : "Business: name unavailable this call. Do not invent one and do not say a placeholder; refer to it simply as the office.",
    `Current time: ${context.currentTimeIso} ${context.timezone}.`,
    formatBusinessHours(context.businessHours),
    `Caller ANI: ${context.callerAni} → searchCustomer already run: ${formatCustomerMatch(context.existingCustomerMatch)}.`,
  ];
  return lines.join(" ");
}

function formatBusinessHours(businessHours: RuntimeContext["businessHours"]): string {
  if (!businessHours) {
    return "Business hours: unknown (lookup unavailable — treat conservatively as after-hours).";
  }
  if (businessHours.isHoliday) {
    return "Business hours: closed (holiday).";
  }
  if (businessHours.isOpen) {
    return "Business hours: open.";
  }
  return businessHours.opensAt
    ? `Business hours: closed (reopens ${businessHours.opensAt}).`
    : "Business hours: closed.";
}

/** True when a matched record holds a real name and a service address. */
export function customerMatchIsComplete(match: RuntimeContext["existingCustomerMatch"]): boolean {
  return Boolean(
    match?.found &&
      match.name &&
      !PLACEHOLDER_NAMES.has(match.name.trim().toLowerCase()) &&
      match.address,
  );
}

function formatCustomerMatch(match: RuntimeContext["existingCustomerMatch"]): string {
  if (!match) {
    return "not yet run";
  }
  if (!match.found) {
    return "no match found";
  }
  // 2026-10-14 tester calls: confirming what was on file ("Is the address
  // still 12340 48th Place South?", "Am I speaking with Frank?") confused
  // callers sharing a phone, read one person's name and address to another,
  // and once let Grace skip asking for the address at all. The record is now
  // used only behind the scenes; every caller gives their own details.
  const id = match.customerId ? ` (customer_id ${match.customerId})` : "";
  return (
    `a previous customer record exists for this phone number${id}. Several people can share a phone, ` +
    "so never say a stored name or address, never ask \"Am I speaking with...\" and never say you already have their information. " +
    "Collect the caller's name and service address exactly as for a new caller, then call createCustomer, which updates this record, then createLead"
  );
}

/**
 * Stored names that are not really names. Call b9f8c847 saved a customer as
 * "Caller" after the model invented it (fixed in prompt v38), and that row
 * is still what a lookup returns for that number. Greeting someone as
 * "Caller" would be worse than not greeting them by name at all.
 */
const PLACEHOLDER_NAMES = new Set([
  "caller",
  "customer",
  "unknown",
  "guest",
  "n/a",
  "na",
  "none",
  "anonymous",
]);
