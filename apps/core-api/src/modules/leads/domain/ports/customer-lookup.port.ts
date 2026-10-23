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
  /** Copied onto each lead when it is saved; see callerOnLead. */
  name?: string;
  address?: Record<string, unknown> | null;
}

/**
 * 2026-10-23, client calls: three different callers on one phone number
 * share ONE customer row (phone is unique per business), and each call
 * overwrote its name and address. The emergency lead from the first call
 * ended up showing the third caller's name and street, which is where a
 * technician would have gone. Each lead now keeps the caller as they were
 * when it was saved, under `qualificationData.caller`.
 */
export function callerOnLead(
  qualificationData: Record<string, unknown> | undefined,
  customer: LookedUpCustomer,
): Record<string, unknown> | undefined {
  if (customer.name === undefined) {
    return qualificationData;
  }
  return {
    ...(qualificationData ?? {}),
    caller: { name: customer.name, address: customer.address ?? null },
  };
}

export interface CustomerLookupPort {
  /** Null if no such customer exists for this tenant — never throws for that case, mirroring every other lookup port in this codebase. */
  findById(tenantId: string, customerId: string): Promise<LookedUpCustomer | null>;
}

export const CUSTOMER_LOOKUP_PORT = Symbol("CUSTOMER_LOOKUP_PORT");
