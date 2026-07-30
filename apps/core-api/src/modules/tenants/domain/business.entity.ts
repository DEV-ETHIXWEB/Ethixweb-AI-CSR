/** docs/06-database-schema.md BUSINESSES */
export interface Business {
  id: string;
  tenantId: string;
  name: string;
  timezone: string;
  crmType: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}
