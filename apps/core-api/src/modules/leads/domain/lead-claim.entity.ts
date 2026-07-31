/** docs/06-database-schema.md LEAD_CLAIMS — a dispatcher taking ownership of working a lead. */
export interface LeadClaim {
  id: string;
  tenantId: string;
  leadId: string;
  claimedByUserId: string;
  claimMethod: string;
  claimedAt: Date;
}
