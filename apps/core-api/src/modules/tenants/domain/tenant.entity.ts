import type { TenantStatus } from "@ethixweb/database";

export type { TenantStatus };

/** docs/06-database-schema.md TENANTS, docs/15-tenant-lifecycle-billing-and-analytics.md §2 */
export interface Tenant {
  id: string;
  name: string;
  planTier: string;
  status: TenantStatus;
  createdAt: Date;
  updatedAt: Date;
}
