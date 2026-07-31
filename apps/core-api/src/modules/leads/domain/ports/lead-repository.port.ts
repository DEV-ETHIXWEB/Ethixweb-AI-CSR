import type { LeadStatus, Prisma, PrismaClient } from "@ethixweb/database";
import type { Lead } from "../lead.entity";

/** `leads` IS RLS-scoped — every method takes the tenant-scoped transaction client (docs/20 ADR-014). */
export type Db = PrismaClient | Prisma.TransactionClient;

export interface CreateLeadInput {
  tenantId: string;
  businessId: string;
  customerId: string;
  callId: string;
  /** Null when the CRM write hasn't succeeded (yet, or at all) — see CreateLeadUseCase. */
  crmLeadId?: string | null | undefined;
  problemSummary: string;
  priority: string;
  leadType: string;
  qualificationData?: Record<string, unknown> | undefined;
}

export interface UpdateLeadFieldsInput {
  problemSummary?: string | undefined;
  priority?: string | undefined;
  leadType?: string | undefined;
}

export interface ListLeadsOptions {
  page: number;
  pageSize: number;
  status?: LeadStatus | undefined;
  priority?: string | undefined;
  createdAfter?: Date | undefined;
  createdBefore?: Date | undefined;
}

export interface ListLeadsResult {
  items: Lead[];
  total: number;
}

export interface LeadRepository {
  /**
   * Throws LeadCallIdAlreadyExistsError (a plain Error, not a DomainError —
   * see its own comment) on a `UNIQUE(call_id)` violation — the documented
   * idempotency backstop for createLead (docs/04 §3.3), not an unexpected
   * failure. Callers (CreateLeadUseCase) are expected to catch this
   * specific case and re-fetch.
   */
  create(db: Db, input: CreateLeadInput): Promise<Lead>;
  findById(db: Db, tenantId: string, id: string): Promise<Lead | null>;
  findByCallId(db: Db, tenantId: string, callId: string): Promise<Lead | null>;
  /** For the CRM `lead.converted` webhook handler — resolves which local lead a CRM-side event refers to. */
  findByCrmLeadId(db: Db, tenantId: string, crmLeadId: string): Promise<Lead | null>;
  /** Sets `crmLeadId` once the CRM-side write succeeds (possibly on a later retry than the original create). */
  setCrmLeadId(db: Db, tenantId: string, id: string, crmLeadId: string): Promise<Lead>;
  /** Applies a partial patch to the mutable descriptive fields — updateLead's local-write half. */
  updateFields(db: Db, tenantId: string, id: string, patch: UpdateLeadFieldsInput): Promise<Lead>;
  /**
   * Conditional update (`WHERE id = id AND status = fromStatus`) — the same
   * optimistic-concurrency-control pattern as the tenants module's
   * TransitionTenantStatusUseCase, for the identical reason: an
   * unconditional update would let two concurrent transitions off the same
   * status silently overwrite each other with no error.
   */
  updateStatus(
    db: Db,
    tenantId: string,
    id: string,
    fromStatus: LeadStatus,
    toStatus: LeadStatus,
  ): Promise<Lead>;
  listByBusiness(
    db: Db,
    tenantId: string,
    businessId: string,
    options: ListLeadsOptions,
  ): Promise<ListLeadsResult>;
}

export const LEAD_REPOSITORY = Symbol("LEAD_REPOSITORY");
