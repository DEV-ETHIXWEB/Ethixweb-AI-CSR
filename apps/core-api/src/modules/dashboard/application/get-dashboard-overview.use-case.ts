import { Inject, Injectable } from "@nestjs/common";
import { setSpanAttributes } from "../../../shared/observability/tracing";
import { ListCallsUseCase } from "../../calls/application/list-calls.use-case";
import { ListIntegrationsUseCase } from "../../crm/application/list-integrations.use-case";
import { GetCapacityConfigUseCase } from "../../capacity-config/application/get-capacity-config.use-case";
import { ListLeadsUseCase } from "../../leads/application/list-leads.use-case";
import { GetUsageSummaryUseCase } from "../../usage/application/get-usage-summary.use-case";
import type { UsageTypeTotal } from "../../usage/domain/ports/usage-record-repository.port";

export interface DashboardOverview {
  tenantId: string;
  businessId: string;
  /**
   * A Postgres-row-derived proxy count, NOT voice-orchestrator's live Redis
   * capacity reservation counter — core-api has no connection to
   * voice-orchestrator's Redis instance and cannot see the real-time
   * in-flight call count. This number reflects `Call` rows with
   * `status = in_progress` as of the last write, which can lag the true
   * live count (a call can end in voice-orchestrator's Redis reservation
   * before core-api's `POST /internal/calls/.../end` write lands, or vice
   * versa for admission).
   */
  activeCallsCount: number;
  /** Leads with `createdAt >= start of today, UTC` — UTC, not the business's local timezone, since no per-business timezone is modeled anywhere in this schema today (Business has no timezone column). */
  leadsCapturedToday: number;
  /** Calls with `startedAt >= start of today, UTC` — same UTC-not-local caveat as leadsCapturedToday. */
  callsToday: number;
  /** activeCallsCount / maxTenantConcurrentCalls, as a 0-1 ratio — same Postgres-proxy caveat as activeCallsCount (NOT the live Redis count), and 0 if maxTenantConcurrentCalls is 0 (avoids a divide-by-zero rather than producing Infinity/NaN). */
  capacityUtilization: number;
  usageToday: UsageTypeTotal[];
  /**
   * No schema field or use case currently reports a business's CRM
   * connection health in one call — `ListIntegrationsUseCase` is the
   * closest existing businessId-scoped read path (CrmModule), so this
   * picks the FIRST configured integration's `status` column verbatim
   * (INTEGRATION_STATUS: pending_verification | active | invalid_credentials
   * | disconnected — see crm/domain/integration.entity.ts) if one exists.
   * `"NOT_CONFIGURED"` (a literal not present in INTEGRATION_STATUS) is
   * returned only when the business has never connected an integration at
   * all — this is a deliberate, explicit sentinel, not a guess at a
   * nonexistent schema field.
   */
  integrationStatus: string;
}

/**
 * Read-only composition over other modules' already-exported use cases —
 * this module owns no Prisma access of its own (see dashboard.module.ts's
 * own comment) beyond GetDashboardHealthUseCase's narrow `SELECT 1` probe.
 */
@Injectable()
export class GetDashboardOverviewUseCase {
  constructor(
    private readonly listCallsUseCase: ListCallsUseCase,
    private readonly listLeadsUseCase: ListLeadsUseCase,
    private readonly getUsageSummaryUseCase: GetUsageSummaryUseCase,
    private readonly getCapacityConfigUseCase: GetCapacityConfigUseCase,
    @Inject(ListIntegrationsUseCase)
    private readonly listIntegrationsUseCase: ListIntegrationsUseCase,
  ) {}

  async execute(tenantId: string, businessId: string): Promise<DashboardOverview> {
    setSpanAttributes({ "ethixweb.tenant_id": tenantId, "ethixweb.business_id": businessId });

    const startOfTodayUtc = new Date();
    startOfTodayUtc.setUTCHours(0, 0, 0, 0);
    const nowIso = new Date().toISOString();

    const [
      activeCalls,
      callsTodayResult,
      leadsTodayResult,
      usageSummary,
      capacityConfig,
      integrations,
    ] = await Promise.all([
      this.listCallsUseCase.execute({
        tenantId,
        businessId,
        page: 1,
        pageSize: 1,
        status: "in_progress",
      }),
      this.listCallsUseCase.execute({
        tenantId,
        businessId,
        page: 1,
        pageSize: 1,
        createdAfter: startOfTodayUtc,
      }),
      this.listLeadsUseCase.execute({
        tenantId,
        businessId,
        page: 1,
        pageSize: 1,
        createdAfter: startOfTodayUtc,
      }),
      this.getUsageSummaryUseCase.execute({
        tenantId,
        businessId,
        from: startOfTodayUtc.toISOString(),
        to: nowIso,
      }),
      this.getCapacityConfigUseCase.execute(tenantId, businessId),
      this.listIntegrationsUseCase.execute(tenantId, businessId),
    ]);

    const activeCallsCount = activeCalls.total;
    const capacityUtilization =
      capacityConfig.maxTenantConcurrentCalls > 0
        ? activeCallsCount / capacityConfig.maxTenantConcurrentCalls
        : 0;

    return {
      tenantId,
      businessId,
      activeCallsCount,
      leadsCapturedToday: leadsTodayResult.total,
      callsToday: callsTodayResult.total,
      capacityUtilization,
      usageToday: usageSummary.totals,
      integrationStatus: integrations[0]?.status ?? "NOT_CONFIGURED",
    };
  }
}
