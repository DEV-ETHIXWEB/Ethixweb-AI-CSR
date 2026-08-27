/** Mirrors apps/core-api/src/modules/usage/interfaces/dto/usage-summary-response.dto.ts exactly. */

export interface UsageTypeTotal {
  usageType: string;
  unit: string;
  totalQuantity: number;
  recordCount: number;
  totalEstimatedProviderCostUsd: string | null;
}

export interface UsageSummary {
  tenantId: string;
  businessId: string | null;
  from: string;
  to: string;
  totals: UsageTypeTotal[];
}
