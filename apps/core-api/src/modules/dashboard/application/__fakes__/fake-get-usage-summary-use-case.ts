import type {
  GetUsageSummaryQuery,
  UsageSummary,
} from "../../../usage/application/get-usage-summary.use-case";

export class FakeGetUsageSummaryUseCase {
  calls: GetUsageSummaryQuery[] = [];
  result: UsageSummary = { tenantId: "tenant-1", businessId: null, from: "", to: "", totals: [] };

  async execute(query: GetUsageSummaryQuery): Promise<UsageSummary> {
    this.calls.push(query);
    return this.result;
  }
}
