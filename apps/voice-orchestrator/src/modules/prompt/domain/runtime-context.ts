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
  currentTimeIso: string;
  timezone: string;
  businessHours: { isOpen: boolean; opensAt?: string; isHoliday: boolean } | null;
  callerAni: string;
  existingCustomerMatch: { found: boolean; name?: string } | null;
}

export function formatRuntimeContext(context: RuntimeContext): string {
  const lines = [
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

function formatCustomerMatch(match: RuntimeContext["existingCustomerMatch"]): string {
  if (!match) {
    return "not yet run";
  }
  if (!match.found) {
    return "no match found";
  }
  return match.name ? `matched existing customer ${match.name}` : "matched an existing customer";
}
