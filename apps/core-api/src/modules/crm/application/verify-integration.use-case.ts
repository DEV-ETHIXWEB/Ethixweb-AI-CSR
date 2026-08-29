import { Inject, Injectable } from "@nestjs/common";
import type { StructuredLogger } from "@ethixweb/shared-kernel";
import { APP_LOGGER } from "../../../shared/observability/app-logger.module";
import { setSpanAttributes } from "../../../shared/observability/tracing";
import { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import {
  CRM_ADAPTER_REGISTRY,
  type CrmAdapterRegistry,
} from "../domain/ports/crm-adapter-registry.port";
import {
  INTEGRATION_REPOSITORY,
  type IntegrationRepository,
} from "../domain/ports/integration-repository.port";
import { CrmAuthenticationError, IntegrationNotFoundError } from "../domain/errors";
import { INTEGRATION_STATUS, type Integration } from "../domain/integration.entity";

/**
 * docs/15-tenant-lifecycle-billing-and-analytics.md §1's onboarding "Verify
 * connection" step, and re-runnable afterward as a periodic health check
 * (this module's "integration health monitoring" requirement) — calls the
 * adapter's cheap, read-only testConnection() and records the outcome on
 * the Integration row rather than just returning a boolean the caller has
 * to remember to persist.
 *
 * DELIBERATELY three separate steps, not one `tenantContext.run` wrapping
 * everything — same connection-pool-safety fix as SearchCustomerUseCase
 * (see that class's own comment for the full reasoning): `testConnection`
 * is "cheap" in request size, not in worst-case duration — it still goes
 * through ResilientCrmAdapter's circuit-breaker + retry (up to 6 attempts,
 * exponential backoff to a 64s cap), so holding a Postgres transaction
 * open around it risked holding it for 60-90+ seconds against exactly the
 * degraded-credentials/degraded-CRM case this check exists to catch.
 */
@Injectable()
export class VerifyIntegrationUseCase {
  constructor(
    private readonly tenantContext: TenantContextService,
    @Inject(INTEGRATION_REPOSITORY) private readonly integrationRepository: IntegrationRepository,
    @Inject(CRM_ADAPTER_REGISTRY) private readonly adapterRegistry: CrmAdapterRegistry,
    @Inject(APP_LOGGER) private readonly logger: StructuredLogger,
  ) {}

  async execute(tenantId: string, integrationId: string): Promise<Integration> {
    setSpanAttributes({ "ethixweb.tenant_id": tenantId, "ethixweb.integration_id": integrationId });

    const { integration, credential } = await this.tenantContext.run(tenantId, async (db) => {
      const integration = await this.integrationRepository.findById(db, tenantId, integrationId);
      if (!integration) {
        throw new IntegrationNotFoundError(integrationId);
      }
      const credential = await this.integrationRepository.getDecryptedCredential(
        db,
        tenantId,
        integrationId,
      );
      return { integration, credential };
    });
    const adapter = this.adapterRegistry.resolve(integration.crmType, tenantId);

    try {
      await adapter.testConnection(credential);
      this.logger.info("CRM integration verified", { tenantId, integrationId });
      return await this.tenantContext.run(tenantId, (db) =>
        this.integrationRepository.updateStatus(
          db,
          tenantId,
          integrationId,
          INTEGRATION_STATUS.ACTIVE,
          new Date(),
        ),
      );
    } catch (error) {
      const status =
        error instanceof CrmAuthenticationError
          ? INTEGRATION_STATUS.INVALID_CREDENTIALS
          : integration.status;
      this.logger.warn("CRM integration verification failed", {
        tenantId,
        integrationId,
        reason: error instanceof Error ? error.message : String(error),
      });
      await this.tenantContext.run(tenantId, (db) =>
        this.integrationRepository.updateStatus(
          db,
          tenantId,
          integrationId,
          status,
          integration.lastVerifiedAt,
        ),
      );
      throw error;
    }
  }
}
