import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { StructuredLogger } from "@ethixweb/shared-kernel";
import { APP_LOGGER } from "../../../shared/observability/app-logger.module";
import { setSpanAttributes } from "../../../shared/observability/tracing";
import { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import { CRM_SYNC_STATUS } from "../domain/crm-sync-log.entity";
import { IntegrationNotFoundError } from "../domain/errors";
import type { CustomerResult } from "../domain/ports/crm-adapter.port";
import {
  CRM_ADAPTER_REGISTRY,
  type CrmAdapterRegistry,
} from "../domain/ports/crm-adapter-registry.port";
import {
  CRM_SYNC_LOG_REPOSITORY,
  type CrmSyncLogRepository,
} from "../domain/ports/crm-sync-log-repository.port";
import {
  INTEGRATION_REPOSITORY,
  type IntegrationRepository,
} from "../domain/ports/integration-repository.port";

export interface SearchCustomerCommand {
  tenantId: string;
  integrationId: string;
  phoneE164: string;
}

/**
 * The adapter-level half of docs/05-crm-integration.md §4's dedup flow —
 * the OTHER half (local `customers` table cache lookup, upsert on hit) is
 * Customer module territory (per this session's module roadmap), not
 * duplicated here. This use-case's job stops at "ask the CRM, return what
 * it said, log the attempt" — every operation is recorded in CrmSyncLog
 * (docs/13 crm-integration module §5), success or failure, independent of
 * the tool broker's own `tool_calls` audit trail.
 */
@Injectable()
export class SearchCustomerUseCase {
  constructor(
    private readonly tenantContext: TenantContextService,
    @Inject(INTEGRATION_REPOSITORY) private readonly integrationRepository: IntegrationRepository,
    @Inject(CRM_ADAPTER_REGISTRY) private readonly adapterRegistry: CrmAdapterRegistry,
    @Inject(CRM_SYNC_LOG_REPOSITORY) private readonly crmSyncLogRepository: CrmSyncLogRepository,
    @Inject(APP_LOGGER) private readonly logger: StructuredLogger,
  ) {}

  async execute(command: SearchCustomerCommand): Promise<CustomerResult | null> {
    setSpanAttributes({
      "ethixweb.tenant_id": command.tenantId,
      "ethixweb.integration_id": command.integrationId,
    });

    return this.tenantContext.run(command.tenantId, async (db) => {
      const integration = await this.integrationRepository.findById(
        db,
        command.tenantId,
        command.integrationId,
      );
      if (!integration) {
        throw new IntegrationNotFoundError(command.integrationId);
      }

      const credential = await this.integrationRepository.getDecryptedCredential(
        db,
        command.tenantId,
        command.integrationId,
      );
      const adapter = this.adapterRegistry.resolve(integration.crmType, command.tenantId);
      const idempotencyKey = randomUUID();

      try {
        const result = await adapter.searchCustomerByPhone(credential, {
          phoneE164: command.phoneE164,
        });
        await this.crmSyncLogRepository.record(db, {
          tenantId: command.tenantId,
          integrationId: command.integrationId,
          operation: "searchCustomerByPhone",
          entityType: "customer",
          entityId: result?.crmCustomerId ?? null,
          status: CRM_SYNC_STATUS.SUCCESS,
          idempotencyKey,
          requestPayload: { phoneE164: command.phoneE164 },
          responsePayload: result,
        });
        return result;
      } catch (error) {
        await this.crmSyncLogRepository.record(db, {
          tenantId: command.tenantId,
          integrationId: command.integrationId,
          operation: "searchCustomerByPhone",
          entityType: "customer",
          entityId: null,
          status: CRM_SYNC_STATUS.FAILED,
          idempotencyKey,
          requestPayload: { phoneE164: command.phoneE164 },
          responsePayload: { error: error instanceof Error ? error.message : String(error) },
        });
        this.logger.warn("CRM searchCustomerByPhone failed", {
          tenantId: command.tenantId,
          integrationId: command.integrationId,
          reason: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    });
  }
}
