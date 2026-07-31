import type { LeadStatus } from "@ethixweb/database";

export type { LeadStatus };

/** docs/06-database-schema.md LEADS. */
export interface Lead {
  id: string;
  tenantId: string;
  businessId: string;
  customerId: string;
  /** Required, unique — one lead per call (docs/04-ai-tool-architecture.md §3.3's hard idempotency constraint), enforced at the DB level, not just in application logic. */
  callId: string;
  /** Null until the CRM-side write succeeds — see CreateLeadUseCase's own comment on why lead creation never blocks on the CRM being reachable. */
  crmLeadId: string | null;
  problemSummary: string;
  // Plain `string` here, not the LeadPriority/LeadType union below —
  // matching this codebase's existing precedent for every other free-text
  // DB column (Business.status, Integration.crmType/authType): the domain
  // entity reflects what the database actually stores (unconstrained text,
  // per docs/06's ER diagram), while the union types exist for validating
  // WRITES at the command/DTO boundary, not for narrowing every read.
  priority: string;
  leadType: string;
  status: LeadStatus;
  qualificationData: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

/** docs/04-ai-tool-architecture.md §3.3's `createLead` tool contract — the authoritative value set, not invented here. */
export const LEAD_PRIORITIES = ["emergency", "urgent", "routine", "estimate"] as const;
export type LeadPriority = (typeof LEAD_PRIORITIES)[number];

/** docs/04-ai-tool-architecture.md §3.3's `createLead` tool contract. */
export const LEAD_TYPES = ["residential", "commercial"] as const;
export type LeadType = (typeof LEAD_TYPES)[number];
