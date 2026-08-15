/** Mirrors apps/core-api/src/modules/leads/interfaces/dto exactly. */

export type LeadStatus =
  "new" | "notified" | "claimed" | "converted_to_job" | "expired" | "duplicate" | "abandoned";

export type LeadPriority = "emergency" | "urgent" | "routine" | "estimate";

export interface LeadSummary {
  id: string;
  tenantId: string;
  businessId: string;
  customerId: string;
  callId: string;
  crmLeadId: string | null;
  problemSummary: string;
  priority: string;
  leadType: string;
  status: LeadStatus;
  qualificationData: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedLeads {
  items: LeadSummary[];
  total: number;
}

export interface CustomerSummary {
  id: string;
  name: string;
  phoneE164: string;
}
