/**
 * What the leads module needs FROM the crm module — owned here, not
 * re-exported from crm's own application layer, so this module depends on
 * an abstraction it controls (Dependency Inversion), the same pattern
 * already established for the customers↔crm boundary
 * (modules/customers/domain/ports/crm-customer-sync.port.ts). Implemented
 * by an adapter living inside the crm module
 * (modules/crm/application/crm-lead-sync.adapter.ts), delegating to that
 * module's already-built CreateLeadUseCase — reusing its circuit-breaker,
 * retry, credential decryption, and CrmSyncLog auditing rather than any of
 * that being reimplemented or bypassed.
 */
export interface CreateCrmLeadInput {
  crmCustomerId: string;
  problemSummary: string;
  priority: string;
  leadType: string;
}

export interface CrmSyncedLead {
  crmLeadId: string;
  status: string;
}

export interface CrmLeadSyncPort {
  /** Null if the business has no active CRM integration. */
  resolveActiveIntegrationId(tenantId: string, businessId: string): Promise<string | null>;
  createLead(
    tenantId: string,
    integrationId: string,
    input: CreateCrmLeadInput,
  ): Promise<CrmSyncedLead>;
}

export const CRM_LEAD_SYNC_PORT = Symbol("CRM_LEAD_SYNC_PORT");
