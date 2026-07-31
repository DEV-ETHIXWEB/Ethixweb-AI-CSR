import { randomUUID } from "node:crypto";
import type {
  CreateCrmLeadInput,
  CrmLeadSyncPort,
  CrmSyncedLead,
} from "../../domain/ports/crm-lead-sync.port";

export class FakeCrmLeadSyncPort implements CrmLeadSyncPort {
  public activeIntegrationId: string | null = "integration-1";
  /** Set to make createLead reject — simulates the CRM being down/unreachable. */
  public failureError: Error | null = null;
  public readonly createLeadCalls: CreateCrmLeadInput[] = [];

  async resolveActiveIntegrationId(_tenantId: string, _businessId: string): Promise<string | null> {
    return this.activeIntegrationId;
  }

  async createLead(
    _tenantId: string,
    _integrationId: string,
    input: CreateCrmLeadInput,
  ): Promise<CrmSyncedLead> {
    if (this.failureError) {
      throw this.failureError;
    }
    this.createLeadCalls.push(input);
    return { crmLeadId: `fake-crm-lead-${randomUUID()}`, status: "created" };
  }
}
