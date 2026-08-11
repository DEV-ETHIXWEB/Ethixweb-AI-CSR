import type { GetCapacityConfigUseCase } from "../../capacity-config/application/get-capacity-config.use-case";
import type { ListIntegrationsUseCase } from "../../crm/application/list-integrations.use-case";
import type { ListCallsUseCase } from "../../calls/application/list-calls.use-case";
import type { ListLeadsUseCase } from "../../leads/application/list-leads.use-case";
import type { GetUsageSummaryUseCase } from "../../usage/application/get-usage-summary.use-case";
import { FakeGetCapacityConfigUseCase } from "./__fakes__/fake-get-capacity-config-use-case";
import { FakeGetUsageSummaryUseCase } from "./__fakes__/fake-get-usage-summary-use-case";
import { FakeListCallsUseCase } from "./__fakes__/fake-list-calls-use-case";
import { FakeListIntegrationsUseCase } from "./__fakes__/fake-list-integrations-use-case";
import { FakeListLeadsUseCase } from "./__fakes__/fake-list-leads-use-case";
import { GetDashboardOverviewUseCase } from "./get-dashboard-overview.use-case";

function buildUseCase() {
  const listCallsUseCase = new FakeListCallsUseCase();
  const listLeadsUseCase = new FakeListLeadsUseCase();
  const getUsageSummaryUseCase = new FakeGetUsageSummaryUseCase();
  const getCapacityConfigUseCase = new FakeGetCapacityConfigUseCase();
  const listIntegrationsUseCase = new FakeListIntegrationsUseCase();
  const useCase = new GetDashboardOverviewUseCase(
    listCallsUseCase as unknown as ListCallsUseCase,
    listLeadsUseCase as unknown as ListLeadsUseCase,
    getUsageSummaryUseCase as unknown as GetUsageSummaryUseCase,
    getCapacityConfigUseCase as unknown as GetCapacityConfigUseCase,
    listIntegrationsUseCase as unknown as ListIntegrationsUseCase,
  );
  return {
    useCase,
    listCallsUseCase,
    listLeadsUseCase,
    getUsageSummaryUseCase,
    getCapacityConfigUseCase,
    listIntegrationsUseCase,
  };
}

describe("GetDashboardOverviewUseCase", () => {
  it("composes activeCallsCount from a status=in_progress ListCallsUseCase query", async () => {
    const { useCase, listCallsUseCase } = buildUseCase();
    listCallsUseCase.activeCallsResult = { items: [], total: 4 };

    const overview = await useCase.execute("tenant-1", "business-1");

    expect(overview.activeCallsCount).toBe(4);
    expect(listCallsUseCase.calls.some((c) => c.status === "in_progress")).toBe(true);
  });

  it("composes leadsCapturedToday and callsToday from createdAfter=start-of-today-UTC queries", async () => {
    const { useCase, listLeadsUseCase, listCallsUseCase } = buildUseCase();
    listLeadsUseCase.result = { items: [], total: 7 };
    listCallsUseCase.callsTodayResult = { items: [], total: 11 };

    const overview = await useCase.execute("tenant-1", "business-1");

    expect(overview.leadsCapturedToday).toBe(7);
    expect(overview.callsToday).toBe(11);
    const leadsQuery = listLeadsUseCase.calls[0];
    expect(leadsQuery?.createdAfter?.getUTCHours()).toBe(0);
    expect(leadsQuery?.createdAfter?.getUTCMinutes()).toBe(0);
  });

  it("computes capacityUtilization as activeCallsCount / maxTenantConcurrentCalls", async () => {
    const { useCase, listCallsUseCase, getCapacityConfigUseCase } = buildUseCase();
    listCallsUseCase.activeCallsResult = { items: [], total: 5 };
    getCapacityConfigUseCase.result = {
      ...getCapacityConfigUseCase.result,
      maxTenantConcurrentCalls: 10,
    };

    const overview = await useCase.execute("tenant-1", "business-1");

    expect(overview.capacityUtilization).toBe(0.5);
  });

  it("guards against divide-by-zero when maxTenantConcurrentCalls is 0", async () => {
    const { useCase, listCallsUseCase, getCapacityConfigUseCase } = buildUseCase();
    listCallsUseCase.activeCallsResult = { items: [], total: 5 };
    getCapacityConfigUseCase.result = {
      ...getCapacityConfigUseCase.result,
      maxTenantConcurrentCalls: 0,
    };

    const overview = await useCase.execute("tenant-1", "business-1");

    expect(overview.capacityUtilization).toBe(0);
    expect(Number.isFinite(overview.capacityUtilization)).toBe(true);
  });

  it("returns usageToday from GetUsageSummaryUseCase's totals", async () => {
    const { useCase, getUsageSummaryUseCase } = buildUseCase();
    getUsageSummaryUseCase.result = {
      tenantId: "tenant-1",
      businessId: "business-1",
      from: "x",
      to: "y",
      totals: [
        {
          usageType: "stt_duration",
          unit: "seconds",
          totalQuantity: 100,
          recordCount: 3,
          totalEstimatedProviderCostUsd: null,
        },
      ],
    };

    const overview = await useCase.execute("tenant-1", "business-1");

    expect(overview.usageToday).toHaveLength(1);
    expect(overview.usageToday[0]?.usageType).toBe("stt_duration");
  });

  it("returns the first configured integration's status when one exists", async () => {
    const { useCase, listIntegrationsUseCase } = buildUseCase();
    listIntegrationsUseCase.result = [
      {
        id: "int-1",
        tenantId: "tenant-1",
        businessId: "business-1",
        crmType: "housecall_pro",
        authType: "oauth2",
        config: {},
        status: "active",
        lastVerifiedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    const overview = await useCase.execute("tenant-1", "business-1");

    expect(overview.integrationStatus).toBe("active");
  });

  it('returns "NOT_CONFIGURED" when no integration exists for the business', async () => {
    const { useCase, listIntegrationsUseCase } = buildUseCase();
    listIntegrationsUseCase.result = [];

    const overview = await useCase.execute("tenant-1", "business-1");

    expect(overview.integrationStatus).toBe("NOT_CONFIGURED");
  });
});
