import type { Integration } from "../../../crm/domain/integration.entity";

export class FakeListIntegrationsUseCase {
  calls: Array<{ tenantId: string; businessId: string }> = [];
  result: Integration[] = [];

  async execute(tenantId: string, businessId: string): Promise<Integration[]> {
    this.calls.push({ tenantId, businessId });
    return this.result;
  }
}
