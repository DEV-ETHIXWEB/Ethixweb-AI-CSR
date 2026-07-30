/**
 * What the customers module needs FROM the crm module — owned here (not a
 * re-export of any of CrmModule's own use-case types) so this module
 * depends on an abstraction it controls, not a concrete class from another
 * module's application layer (Dependency Inversion Principle, the same
 * discipline as every repository port in this codebase). CrmModule
 * provides the implementation (infrastructure/crm-customer-sync.adapter.ts
 * inside the crm module) by delegating to its own already-built
 * SearchCustomerUseCase/CreateCustomerUseCase/IntegrationRepository —
 * reusing that module's circuit-breaker/retry/credential-decryption/
 * CrmSyncLog-audit machinery rather than duplicating any of it.
 */
export interface CrmSyncedCustomer {
  crmCustomerId: string;
  name: string;
  phoneE164: string;
  email?: string | undefined;
  raw: unknown;
}

export interface CreateCrmCustomerInput {
  name: string;
  phoneE164: string;
  email?: string | undefined;
}

export interface CrmCustomerSyncPort {
  /** Null if the business has no active CRM integration (see NoCrmIntegrationConfiguredError, ../errors.ts). */
  resolveActiveIntegrationId(tenantId: string, businessId: string): Promise<string | null>;
  /** Null on a genuine "no such customer in the CRM" result — never throws for that case. */
  searchCustomer(
    tenantId: string,
    integrationId: string,
    phoneE164: string,
  ): Promise<CrmSyncedCustomer | null>;
  createCustomer(
    tenantId: string,
    integrationId: string,
    input: CreateCrmCustomerInput,
  ): Promise<CrmSyncedCustomer>;
}

export const CRM_CUSTOMER_SYNC_PORT = Symbol("CRM_CUSTOMER_SYNC_PORT");
