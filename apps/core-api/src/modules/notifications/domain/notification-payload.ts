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
