import { Inject, Injectable } from "@nestjs/common";
import { INTEGRATION_STATUS } from "../domain/integration.entity";
import {
  INTEGRATION_REPOSITORY,
  type IntegrationRepository,
} from "../domain/ports/integration-repository.port";
import { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import type {
  CreateCrmLeadInput,
  CrmLeadSyncPort,
  CrmSyncedLead,
} from "../../leads/domain/ports/crm-lead-sync.port";
import { CreateLeadUseCase } from "./create-lead.use-case";

/**
 * Implements the leads module's own CrmLeadSyncPort by delegating to this
 * module's already-built CreateLeadUseCase — same pattern, same reasoning,
 * as CrmCustomerSyncAdapter for the customers module: the leads module
 * gets circuit-breaker/retry, credential decryption, and CrmSyncLog
 * auditing for free, and never touches crm's internals directly.
 */
@Injectable()
export class CrmLeadSyncAdapter implements CrmLeadSyncPort {
  constructor(
    private readonly tenantContext: TenantContextService,
    @Inject(INTEGRATION_REPOSITORY) private readonly integrationRepository: IntegrationRepository,
    private readonly createLeadUseCase: CreateLeadUseCase,
  ) {}

  async resolveActiveIntegrationId(tenantId: string, businessId: string): Promise<string | null> {
    const integrations = await this.tenantContext.run(tenantId, (db) =>
      this.integrationRepository.listByBusiness(db, tenantId, businessId),
    );
    // Same Phase 1 "one active integration per business" assumption as
    // CrmCustomerSyncAdapter's own comment — duplicated here (a handful of
    // lines) rather than sharing a helper across two otherwise-unrelated
    // adapters, matching this codebase's "three similar lines beats a
    // premature abstraction" convention.
    const active = integrations.find(
      (integration) => integration.status === INTEGRATION_STATUS.ACTIVE,
    );
    return active?.id ?? null;
  }

  async createLead(
    tenantId: string,
    integrationId: string,
    input: CreateCrmLeadInput,
  ): Promise<CrmSyncedLead> {
    const result = await this.createLeadUseCase.execute({
      tenantId,
      integrationId,
      crmCustomerId: input.crmCustomerId,
      problemSummary: input.problemSummary,
      priority: input.priority,
      leadType: input.leadType,
    });
    return { crmLeadId: result.crmLeadId, status: result.status };
  }
}
