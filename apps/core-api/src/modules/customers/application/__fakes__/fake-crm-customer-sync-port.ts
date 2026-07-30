import { randomUUID } from "node:crypto";
import type {
  CreateCrmCustomerInput,
  CrmCustomerSyncPort,
  CrmSyncedCustomer,
} from "../../domain/ports/crm-customer-sync.port";

export class FakeCrmCustomerSyncPort implements CrmCustomerSyncPort {
  public activeIntegrationId: string | null = "integration-1";
  public searchResults = new Map<string, CrmSyncedCustomer>();
  public readonly createCustomerCalls: CreateCrmCustomerInput[] = [];

  async resolveActiveIntegrationId(_tenantId: string, _businessId: string): Promise<string | null> {
    return this.activeIntegrationId;
  }

  async searchCustomer(
    _tenantId: string,
    _integrationId: string,
    phoneE164: string,
  ): Promise<CrmSyncedCustomer | null> {
    return this.searchResults.get(phoneE164) ?? null;
  }

  async createCustomer(
    _tenantId: string,
    _integrationId: string,
    input: CreateCrmCustomerInput,
  ): Promise<CrmSyncedCustomer> {
    this.createCustomerCalls.push(input);
    return {
      crmCustomerId: `fake-crm-customer-${randomUUID()}`,
      name: input.name,
      phoneE164: input.phoneE164,
      email: input.email,
      raw: { ...input },
    };
  }
}
