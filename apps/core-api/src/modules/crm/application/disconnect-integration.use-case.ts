import { Inject, Injectable } from "@nestjs/common";
import type { StructuredLogger } from "@ethixweb/shared-kernel";
import { APP_LOGGER } from "../../../shared/observability/app-logger.module";
import { setSpanAttributes } from "../../../shared/observability/tracing";
import { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import { IntegrationNotFoundError } from "../domain/errors";
import { INTEGRATION_STATUS, type Integration } from "../domain/integration.entity";
import {
  INTEGRATION_REPOSITORY,
  type IntegrationRepository,
} from "../domain/ports/integration-repository.port";

/**
 * Sets status to `disconnected` — never a hard delete. `Integration` has no
 * documented lifecycle state machine the way `Tenant.status` does (docs/15
 * §2), so this doesn't enforce a transition graph the way
 * TransitionTenantStatusUseCase does; it's a plain status flip. Keeping the
 * row (rather than deleting it) preserves CrmSyncLog's foreign key and the
 * historical audit trail of everything this integration ever did.
 */
@Injectable()
export class DisconnectIntegrationUseCase {
  constructor(
    private readonly tenantContext: TenantContextService,
    @Inject(INTEGRATION_REPOSITORY) private readonly integrationRepository: IntegrationRepository,
    @Inject(APP_LOGGER) private readonly logger: StructuredLogger,
  ) {}

  async execute(tenantId: string, integrationId: string): Promise<Integration> {
    setSpanAttributes({ "ethixweb.tenant_id": tenantId, "ethixweb.integration_id": integrationId });

    return this.tenantContext.run(tenantId, async (db) => {
      const existing = await this.integrationRepository.findById(db, tenantId, integrationId);
      if (!existing) {
        throw new IntegrationNotFoundError(integrationId);
      }

      const updated = await this.integrationRepository.updateStatus(
        db,
        tenantId,
        integrationId,
        INTEGRATION_STATUS.DISCONNECTED,
        existing.lastVerifiedAt,
      );
      this.logger.info("CRM integration disconnected", { tenantId, integrationId });
      return updated;
    });
  }
}
