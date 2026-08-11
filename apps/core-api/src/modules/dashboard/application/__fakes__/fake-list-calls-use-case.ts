import type { ListCallsQuery } from "../../../calls/application/list-calls.use-case";
import type { ListCallsResult } from "../../../calls/domain/ports/call-repository.port";

/**
 * Small fake with an `execute` method, consistent with this codebase's
 * `__fakes__/` convention of real fake objects over raw jest mocks. Keyed
 * on whether the query carries a `status` filter (the
 * activeCallsCount = status:"in_progress" query) vs not (the
 * callsToday = createdAfter-only query) — GetDashboardOverviewUseCase
 * issues both concurrently via `Promise.all`, so a plain FIFO queue
 * wouldn't reliably map results to the right call.
 */
export class FakeListCallsUseCase {
  calls: ListCallsQuery[] = [];
  activeCallsResult: ListCallsResult = { items: [], total: 0 };
  callsTodayResult: ListCallsResult = { items: [], total: 0 };

  async execute(query: ListCallsQuery): Promise<ListCallsResult> {
    this.calls.push(query);
    return query.status !== undefined ? this.activeCallsResult : this.callsTodayResult;
  }
}
