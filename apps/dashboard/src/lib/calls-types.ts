/** Mirrors apps/core-api/src/modules/calls/interfaces/dto exactly. */

export type CallStatus = "in_progress" | "completed" | "abandoned";

export interface CallSummary {
  id: string;
  tenantId: string;
  businessId: string;
  customerId: string | null;
  direction: "inbound" | "outbound";
  fromNumber: string;
  toNumber: string;
  telephonyCallSid: string;
  status: CallStatus;
  endReason: string | null;
  durationSeconds: number | null;
  startedAt: string;
  endedAt: string | null;
}

export interface PaginatedCalls {
  items: CallSummary[];
  total: number;
}
