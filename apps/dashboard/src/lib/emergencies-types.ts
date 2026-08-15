/** Mirrors apps/core-api/src/modules/dashboard/interfaces/dto/dashboard-emergencies-response.dto.ts exactly. */

export interface DashboardEmergency {
  id: string;
  callId: string | null;
  leadId: string | null;
  severity: string;
  action: string;
  matchedPattern: string | null;
  createdAt: string;
}

export interface DashboardEmergencies {
  items: DashboardEmergency[];
  total: number;
}
