import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { IdempotencyStore, StructuredLogger } from "@ethixweb/shared-kernel";
import { IDEMPOTENCY_STORE } from "../../../shared/idempotency/idempotency-store.token";
import { APP_LOGGER } from "../../../shared/observability/app-logger.module";
import { setSpanAttributes } from "../../../shared/observability/tracing";
import { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import { CRM_SYNC_STATUS } from "../domain/crm-sync-log.entity";
import { CrmSyncInProgressError, IntegrationNotFoundError } from "../domain/errors";
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

export interface CreateCustomerCommand {
  tenantId: string;
  integrationId: string;
  name: string;
  phoneE164: string;
  email?: string | undefined;
  address?: Record<string, unknown> | undefined;
  /**
   * Opt-in caller-supplied idempotency key (shared-kernel's `IdempotencyStore`
   * — its own doc comment names CRM writes as an intended consumer).
   * Retrying with the same key returns the first call's cached result
   * instead of creating a second customer; a concurrent retry gets
   * CrmSyncInProgressError instead of racing the first attempt. Omitted
   * entirely for callers that don't need retry-safety (e.g. a one-shot
   * internal call) — no dedup is attempted in that case, matching how
   * Stripe-style idempotency keys are opt-in, not mandatory.
   */
  idempotencyKey?: string | undefined;
}

/**
 * Per docs/05-crm-integration.md §4: callers are expected to have already
 * run SearchCustomerUseCase and confirmed no match before calling this —
 * this use-case itself has no search-before-create logic (that discipline
 * belongs to whatever orchestrates the two, matching the confirmed fact
 * that HCP itself has no create-time duplicate prevention, docs/05 §2.8).
 *
 * `doExecute` is DELIBERATELY three separate steps, not one
 * `tenantContext.run` wrapping everything — same connection-pool-safety
 * fix as SearchCustomerUseCase (see that class's own comment for the full
 * reasoning): `adapter.createCustomer` goes through ResilientCrmAdapter's
 * circuit-breaker + retry (up to 6 attempts, exponential backoff to a 64s
 * cap), so holding a Postgres transaction open around it risked holding it
 * for 60-90+ seconds under a degraded CRM.
 */
@Injectable()
export class CreateCustomerUseCase {
  constructor(
    private readonly tenantContext: TenantContextService,
    @Inject(INTEGRATION_REPOSITORY) private readonly integrationRepository: IntegrationRepository,
    @Inject(CRM_ADAPTER_REGISTRY) private readonly adapterRegistry: CrmAdapterRegistry,
    @Inject(CRM_SYNC_LOG_REPOSITORY) private readonly crmSyncLogRepository: CrmSyncLogRepository,
    @Inject(IDEMPOTENCY_STORE) private readonly idempotencyStore: IdempotencyStore,
    @Inject(APP_LOGGER) private readonly logger: StructuredLogger,
  ) {}

  async execute(command: CreateCustomerCommand): Promise<CustomerResult> {
    setSpanAttributes({
      "ethixweb.tenant_id": command.tenantId,
      "ethixweb.integration_id": command.integrationId,
    });

    const dedupeKey = command.idempotencyKey
      ? `crm:createCustomer:${command.tenantId}:${command.integrationId}:${command.idempotencyKey}`
      : undefined;

    if (dedupeKey) {
      const outcome = await this.idempotencyStore.begin<CustomerResult>(dedupeKey);
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

  private async doExecute(command: CreateCustomerCommand): Promise<CustomerResult> {
    const { integration, credential } = await this.tenantContext.run(
      command.tenantId,
      async (db) => {
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
        return { integration, credential };
      },
    );
    const adapter = this.adapterRegistry.resolve(integration.crmType, command.tenantId);
    // The CrmSyncLog row's own idempotency key is a per-attempt audit
    // identity (docs/13 crm-integration §5), a distinct concept from the
    // caller-facing dedup key above — a caller retrying with the SAME
    // idempotencyKey after this use-case already cached a "completed"
    // result never reaches this code path a second time at all (returned
    // early above), so a fresh row per genuine attempt is correct here.
    const syncLogKey = randomUUID();
    const requestPayload = {
      name: command.name,
      phoneE164: command.phoneE164,
      email: command.email,
    };

    try {
      const result = await adapter.createCustomer(credential, {
        name: command.name,
        phoneE164: command.phoneE164,
        email: command.email,
        address: command.address,
      });
      await this.tenantContext.run(command.tenantId, (db) =>
        this.crmSyncLogRepository.record(db, {
          tenantId: command.tenantId,
          integrationId: command.integrationId,
          operation: "createCustomer",
          entityType: "customer",
          entityId: result.crmCustomerId,
          status: CRM_SYNC_STATUS.SUCCESS,
          idempotencyKey: syncLogKey,
          requestPayload,
          responsePayload: result,
        }),
      );
      this.logger.info("CRM customer created", {
        tenantId: command.tenantId,
        integrationId: command.integrationId,
        crmCustomerId: result.crmCustomerId,
      });
      return result;
    } catch (error) {
      await this.tenantContext.run(command.tenantId, (db) =>
        this.crmSyncLogRepository.record(db, {
          tenantId: command.tenantId,
          integrationId: command.integrationId,
          operation: "createCustomer",
          entityType: "customer",
          entityId: null,
          status: CRM_SYNC_STATUS.FAILED,
          idempotencyKey: syncLogKey,
          requestPayload,
          responsePayload: { error: error instanceof Error ? error.message : String(error) },
        }),
      );
      throw error;
    }
  }
}
