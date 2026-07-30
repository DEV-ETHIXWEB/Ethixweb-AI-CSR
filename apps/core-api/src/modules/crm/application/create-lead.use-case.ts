import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { IdempotencyStore, StructuredLogger } from "@ethixweb/shared-kernel";
import { IDEMPOTENCY_STORE } from "../../../shared/idempotency/idempotency-store.token";
import { APP_LOGGER } from "../../../shared/observability/app-logger.module";
import { setSpanAttributes } from "../../../shared/observability/tracing";
import { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import { CRM_SYNC_STATUS } from "../domain/crm-sync-log.entity";
import { CrmSyncInProgressError, IntegrationNotFoundError } from "../domain/errors";
import type { LeadResult } from "../domain/ports/crm-adapter.port";
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

export interface CreateLeadCommand {
  tenantId: string;
  integrationId: string;
  crmCustomerId: string;
  problemSummary: string;
  priority: string;
  leadType: string;
  /** See CreateCustomerCommand's own comment — same opt-in caller-facing idempotency. */
  idempotencyKey?: string | undefined;
}

/**
 * Per docs/05-crm-integration.md §3's load-bearing safety contract: creating
 * a Lead must never result in a technician dispatched or a calendar slot
 * reserved. This use-case only ever calls `CRMAdapter.createLead()` — never
 * any job-creation/scheduling method, because those methods don't exist
 * anywhere on the CRMAdapter interface at all (the same "capability doesn't
 * exist" principle docs/04 §1 applies to the AI's tool surface, applied
 * here one layer down).
 */
@Injectable()
export class CreateLeadUseCase {
  constructor(
    private readonly tenantContext: TenantContextService,
    @Inject(INTEGRATION_REPOSITORY) private readonly integrationRepository: IntegrationRepository,
    @Inject(CRM_ADAPTER_REGISTRY) private readonly adapterRegistry: CrmAdapterRegistry,
    @Inject(CRM_SYNC_LOG_REPOSITORY) private readonly crmSyncLogRepository: CrmSyncLogRepository,
    @Inject(IDEMPOTENCY_STORE) private readonly idempotencyStore: IdempotencyStore,
    @Inject(APP_LOGGER) private readonly logger: StructuredLogger,
  ) {}

  async execute(command: CreateLeadCommand): Promise<LeadResult> {
    setSpanAttributes({
      "ethixweb.tenant_id": command.tenantId,
      "ethixweb.integration_id": command.integrationId,
    });

    const dedupeKey = command.idempotencyKey
      ? `crm:createLead:${command.tenantId}:${command.integrationId}:${command.idempotencyKey}`
      : undefined;

    if (dedupeKey) {
      const outcome = await this.idempotencyStore.begin<LeadResult>(dedupeKey);
      if (outcome.status === "completed") {
        return outcome.result;
      }
      if (outcome.status === "in_flight") {
        throw new CrmSyncInProgressError(command.idempotencyKey as string);
      }
    }

    try {
      const result = await this.doExecute(command);
      if (dedupeKey) {
        await this.idempotencyStore.complete(dedupeKey, result);
      }
      return result;
    } catch (error) {
      if (dedupeKey) {
        await this.idempotencyStore.release(dedupeKey);
      }
      throw error;
    }
  }

  private async doExecute(command: CreateLeadCommand): Promise<LeadResult> {
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
      const syncLogKey = randomUUID();
      const requestPayload = {
        crmCustomerId: command.crmCustomerId,
        problemSummary: command.problemSummary,
        priority: command.priority,
        leadType: command.leadType,
      };

      try {
        const result = await adapter.createLead(credential, {
          crmCustomerId: command.crmCustomerId,
          problemSummary: command.problemSummary,
          priority: command.priority,
          leadType: command.leadType,
        });
        await this.crmSyncLogRepository.record(db, {
          tenantId: command.tenantId,
          integrationId: command.integrationId,
          operation: "createLead",
          entityType: "lead",
          entityId: result.crmLeadId,
          status: CRM_SYNC_STATUS.SUCCESS,
          idempotencyKey: syncLogKey,
          requestPayload,
          responsePayload: result,
        });
        this.logger.info("CRM lead created", {
          tenantId: command.tenantId,
          integrationId: command.integrationId,
          crmLeadId: result.crmLeadId,
        });
        return result;
      } catch (error) {
        await this.crmSyncLogRepository.record(db, {
          tenantId: command.tenantId,
          integrationId: command.integrationId,
          operation: "createLead",
          entityType: "lead",
          entityId: null,
          status: CRM_SYNC_STATUS.FAILED,
          idempotencyKey: syncLogKey,
          requestPayload,
          responsePayload: { error: error instanceof Error ? error.message : String(error) },
        });
        throw error;
      }
    });
  }
}
