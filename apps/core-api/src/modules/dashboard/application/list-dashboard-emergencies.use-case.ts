import { Injectable } from "@nestjs/common";
import { setSpanAttributes } from "../../../shared/observability/tracing";

export interface DashboardEmergency {
  id: string;
  callId: string | null;
  leadId: string | null;
  severity: string;
  action: string;
  matchedPattern: string | null;
  createdAt: string;
}

export interface ListDashboardEmergenciesResult {
  items: DashboardEmergency[];
  total: number;
}

/**
 * KNOWN GAP, confirmed by direct audit before writing this: no schema
 * field currently marks a `Lead` or `Call` row as emergency-escalated.
 * `EscalateEmergencyUseCase` (emergency-rules module) returns a real-time
 * classification synchronously to its caller (the tool broker, mid-call)
 * and persists NOTHING — no `isEmergency`/`severity` column exists on
 * either `Lead` or `Call` in packages/database/prisma/schema.prisma, and no
 * join table records escalation history. This use case therefore cannot
 * query historical emergency escalations from Postgres today; it returns
 * an empty result rather than guessing at a nonexistent field or joining
 * against something that isn't there. Closing this gap requires a schema
 * migration (e.g. an `isEmergency`/`severity` column on `Lead`, or a
 * dedicated `emergency_escalations` table capturing every
 * EscalateEmergencyUseCase result) — explicitly out of scope for this
 * build (schema.prisma and migrations are off-limits here).
 */
@Injectable()
export class ListDashboardEmergenciesUseCase {
  async execute(tenantId: string, businessId: string): Promise<ListDashboardEmergenciesResult> {
    setSpanAttributes({ "ethixweb.tenant_id": tenantId, "ethixweb.business_id": businessId });
    return { items: [], total: 0 };
  }
}
