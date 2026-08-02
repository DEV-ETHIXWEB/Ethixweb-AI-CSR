/**
 * docs/13-implementation-backlog.md `calls` module item 2: "Call lifecycle
 * service: call started/ended webhooks from the voice orchestrator, status
 * transitions." This entity is deliberately narrow — only what
 * `Lead.callId`'s FK integrity, tenant/business ownership, and lifecycle
 * status require. Transcript/ToolCall persistence, recording upload, and
 * the admin call-detail API (docs/13 items 3-5) are explicitly NOT built
 * here — see this module's own errors.ts / calls.module.ts comments for
 * why that's a documented boundary, not an oversight.
 */
export const CALL_STATUSES = ["in_progress", "completed", "abandoned"] as const;
export type CallStatus = (typeof CALL_STATUSES)[number];

export const CALL_DIRECTIONS = ["inbound", "outbound"] as const;
export type CallDirection = (typeof CALL_DIRECTIONS)[number];

export interface Call {
  id: string;
  tenantId: string;
  businessId: string;
  customerId: string | null;
  direction: CallDirection;
  fromNumber: string;
  toNumber: string;
  /** The telephony/runtime provider's own call identifier (e.g. Twilio CallSid) — the idempotency key for call creation, `UNIQUE` at the database layer. */
  telephonyCallSid: string;
  status: CallStatus;
  endReason: string | null;
  durationSeconds: number | null;
  startedAt: string;
  endedAt: string | null;
}
