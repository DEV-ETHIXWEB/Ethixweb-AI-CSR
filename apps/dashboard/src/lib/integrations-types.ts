/** Mirrors apps/core-api/src/modules/crm/interfaces/dto/integration-response.dto.ts exactly. Never carries a credential field — the DTO itself has none, confirmed by reading it directly. */

export const CRM_TYPES = [
  "housecall_pro",
  "service_titan",
  "jobber",
  "service_fusion",
  "field_edge",
] as const;

export interface Integration {
  id: string;
  tenantId: string;
  businessId: string;
  crmType: string;
  authType: string;
  status: string;
  lastVerifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
