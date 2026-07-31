/**
 * What the leads module needs FROM the customers module — owned here for
 * the same Dependency Inversion reason as CrmLeadSyncPort. createLead's
 * input is this platform's own `customerId` (what searchCustomer/
 * createCustomer already returned to the caller per
 * docs/04-ai-tool-architecture.md §3.2/§3.3), but the CRM-side write needs
 * that customer's `crmCustomerId` — this lookup is how CreateLeadUseCase
 * gets both the verification that the customerId is real/tenant-scoped
 * AND the CRM-side id in one round trip, without duplicating any of
 * customers' own resolution/caching logic.
 */
export interface LookedUpCustomer {
  id: string;
  tenantId: string;
  businessId: string;
  crmCustomerId: string | null;
}

export interface CustomerLookupPort {
  /** Null if no such customer exists for this tenant — never throws for that case, mirroring every other lookup port in this codebase. */
  findById(tenantId: string, customerId: string): Promise<LookedUpCustomer | null>;
}

export const CUSTOMER_LOOKUP_PORT = Symbol("CUSTOMER_LOOKUP_PORT");
