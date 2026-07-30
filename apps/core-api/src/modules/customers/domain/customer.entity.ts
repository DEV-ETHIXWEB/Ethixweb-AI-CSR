/**
 * docs/06-database-schema.md CUSTOMERS. Deliberately a CACHE, not this
 * platform's own source of truth for customer data — `crmCustomerId` points
 * at the real record in the tenant's connected CRM, and `crmRawCache` is
 * "a JSONB cache of the last-fetched CRM record, refreshed on read with a
 * TTL" (docs/06, the CUSTOMERS table's own annotation). That's why this
 * module has no update/delete-customer use case: editing a customer's
 * name/email/address locally would drift from the CRM's own data with
 * nothing to reconcile it back — the only legitimate way this row's fields
 * change is a fresh read from the CRM overwriting the cache.
 */
export interface Customer {
  id: string;
  tenantId: string;
  businessId: string;
  crmCustomerId: string | null;
  phoneE164: string;
  name: string;
  email: string | null;
  address: Record<string, unknown> | null;
  crmRawCache: unknown;
  createdAt: Date;
  updatedAt: Date;
}
