import type { Customer } from "../../customers/domain/customer.entity";
import type { Lead } from "../../leads/domain/lead.entity";

/**
 * docs/07 §3's "ONE canonical data model, N renderers" — the single
 * source of truth every channel renders from, so the actual CONTENT is
 * guaranteed identical across SMS/email/Slack/Teams, only the formatting
 * differs.
 */
export interface NotificationPayload {
  leadId: string;
  priority: string;
  leadType: string;
  customerName: string;
  customerPhone: string;
  address: string;
  problemSummary: string;
  /** Auth-gated, tenant-scoped transcript link — null until the `calls` module (Phase 10) exists to have a transcript to link to. */
  transcriptLink: string | null;
}

/** Shared by SendLeadNotificationUseCase and RequeueNotificationUseCase so a redriven dead-letter notification renders identically to the original send, not a second, drifting implementation. */
export function buildNotificationPayload(lead: Lead, customer: Customer): NotificationPayload {
  // The caller as they were when THIS lead was saved, not the shared customer
  // row a later caller on the same number may have overwritten since. See
  // callerOnLead in the leads module.
  const caller = callerSavedOn(lead);
  return {
    leadId: lead.id,
    priority: lead.priority,
    leadType: lead.leadType,
    customerName: caller?.name ?? customer.name,
    customerPhone: customer.phoneE164,
    address: formatAddress(caller ? caller.address : customer.address),
    problemSummary: lead.problemSummary,
    transcriptLink: null,
  };
}

function callerSavedOn(
  lead: Lead,
): { name: string; address: Record<string, unknown> | null } | null {
  const caller = lead.qualificationData?.["caller"];
  if (!caller || typeof caller !== "object") {
    return null;
  }
  const { name, address } = caller as { name?: unknown; address?: unknown };
  if (typeof name !== "string" || name.length === 0) {
    return null;
  }
  return {
    name,
    address: address && typeof address === "object" ? (address as Record<string, unknown>) : null,
  };
}

function formatAddress(address: Record<string, unknown> | null): string {
  if (!address) {
    return "address on file";
  }
  const parts = [address["street"], address["city"], address["state"], address["zip"]].filter(
    (part): part is string => typeof part === "string" && part.length > 0,
  );
  return parts.length > 0 ? parts.join(", ") : "address on file";
}
