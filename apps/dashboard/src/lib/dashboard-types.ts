/** Mirrors apps/core-api/src/modules/dashboard/interfaces/dto exactly — kept as plain types, not re-imported across the app boundary (core-api and this app are separate deployables). */

export interface UsageTypeTotal {
  usageType: string;
  unit: string;
  totalQuantity: number;
  recordCount: number;
  totalEstimatedProviderCostUsd: number | null;
}

export interface DashboardOverview {
  tenantId: string;
  businessId: string;
  activeCallsCount: number;
  leadsCapturedToday: number;
  callsToday: number;
  capacityUtilization: number;
  usageToday: UsageTypeTotal[];
  integrationStatus: string;
}

export type ComponentHealth = "healthy" | "down" | "unknown";

export interface DashboardHealth {
  database: ComponentHealth;
  voiceOrchestrator: ComponentHealth;
  redis: ComponentHealth;
  hcp: ComponentHealth;
  telephony: ComponentHealth;
  stt: ComponentHealth;
  tts: ComponentHealth;
  llm: ComponentHealth;
}
