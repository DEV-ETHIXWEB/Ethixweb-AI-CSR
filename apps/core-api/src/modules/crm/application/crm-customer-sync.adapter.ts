import { Inject, Injectable } from "@nestjs/common";
import { INTEGRATION_STATUS } from "../domain/integration.entity";
import {
  INTEGRATION_REPOSITORY,
  type IntegrationRepository,
} from "../domain/ports/integration-repository.port";
import { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import type {
  CreateCrmCustomerInput,
  CrmCustomerSyncPort,
  CrmSyncedCustomer,
} from "../../customers/domain/ports/crm-customer-sync.port";
import { CreateCustomerUseCase } from "./create-customer.use-case";
import { SearchCustomerUseCase } from "./search-customer.use-case";

/**
 * Implements the customers module's own CrmCustomerSyncPort by delegating
 * to this module's already-built use-cases — the customers module gets
 * circuit-breaker/retry, credential decryption, and CrmSyncLog auditing for
 * free, rather than any of that being reimplemented or bypassed. Lives in
 * the crm module (not customers) because it's the one side of this
 * boundary that actually depends on crm's internals; customers' own domain
 * only ever sees the port it defined.
 */
@Injectable()
export class CrmCustomerSyncAdapter implements CrmCustomerSyncPort {
  constructor(
    private readonly tenantContext: TenantContextService,
    @Inject(INTEGRATION_REPOSITORY) private readonly integrationRepository: IntegrationRepository,
    private readonly searchCustomerUseCase: SearchCustomerUseCase,
    private readonly createCustomerUseCase: CreateCustomerUseCase,
  ) {}

  async resolveActiveIntegrationId(tenantId: string, businessId: string): Promise<string | null> {
    const integrations = await this.tenantContext.run(tenantId, (db) =>
      this.integrationRepository.listByBusiness(db, tenantId, businessId),
    );
    // Phase 1 assumption, matching docs/15-tenant-lifecycle-billing-and-analytics.md
    // §1's onboarding flow ("Connect CRM" is singular): a business has at
    // most one ACTIVE integration at a time. If more than one is ever
    // somehow active, the first is used — a future multi-CRM-per-business
    // design would need a real "primary integration" concept, not built
    // here since nothing in the architecture docs calls for it yet.
    const active = integrations.find(
      (integration) => integration.status === INTEGRATION_STATUS.ACTIVE,
    );
    return active?.id ?? null;
  }

  async searchCustomer(
    tenantId: string,
    integrationId: string,
    phoneE164: string,
  ): Promise<CrmSyncedCustomer | null> {
    const result = await this.searchCustomerUseCase.execute({ tenantId, integrationId, phoneE164 });
    return result ? { ...result } : null;
  }

  async createCustomer(
    tenantId: string,
    integrationId: string,
    input: CreateCrmCustomerInput,
  ): Promise<CrmSyncedCustomer> {
    const result = await this.createCustomerUseCase.execute({
      tenantId,
      integrationId,
      name: input.name,
      phoneE164: input.phoneE164,
      email: input.email,
    });
    return { ...result };
  }
}
