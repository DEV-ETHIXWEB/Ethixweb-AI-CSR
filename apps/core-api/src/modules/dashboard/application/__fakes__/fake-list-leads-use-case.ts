import type { ListLeadsQuery } from "../../../leads/application/list-leads.use-case";
import type { ListLeadsResult } from "../../../leads/domain/ports/lead-repository.port";

export class FakeListLeadsUseCase {
  calls: ListLeadsQuery[] = [];
  result: ListLeadsResult = { items: [], total: 0 };

  async execute(query: ListLeadsQuery): Promise<ListLeadsResult> {
    this.calls.push(query);
    return this.result;
  }
}
