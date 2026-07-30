import { Inject, Injectable } from "@nestjs/common";
import type { StructuredLogger } from "@ethixweb/shared-kernel";
import { APP_LOGGER } from "../../../shared/observability/app-logger.module";
import { setSpanAttributes } from "../../../shared/observability/tracing";
import { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import type { Business } from "../domain/business.entity";
import { BusinessNotFoundError } from "../domain/errors";
import {
  BUSINESS_REPOSITORY,
  type BusinessRepository,
} from "../domain/ports/business-repository.port";

export interface UpdateBusinessCommand {
  name: string;
  timezone: string;
}

/**
 * Name and timezone only — deliberately not `crmType`. Switching a
 * business's CRM is a full data-migration flow (backfilling customer
 * records into the new CRM, dual-write window, cutover — see
 * docs/15-tenant-lifecycle-billing-and-analytics.md §5.2), not a field
 * edit; that flow isn't built yet and this endpoint must not offer a
 * shortcut that skips it and silently orphans existing CRM-linked data.
 */
@Injectable()
export class UpdateBusinessUseCase {
  constructor(
    private readonly tenantContext: TenantContextService,
    @Inject(BUSINESS_REPOSITORY) private readonly businessRepository: BusinessRepository,
    @Inject(APP_LOGGER) private readonly logger: StructuredLogger,
  ) {}

  async execute(
    tenantId: string,
    businessId: string,
    command: UpdateBusinessCommand,
  ): Promise<Business> {
    setSpanAttributes({ "ethixweb.tenant_id": tenantId, "ethixweb.business_id": businessId });

    return this.tenantContext.run(tenantId, async (db) => {
      const existing = await this.businessRepository.findById(db, tenantId, businessId);
      if (!existing) {
        throw new BusinessNotFoundError(businessId);
      }

      const updated = await this.businessRepository.update(db, tenantId, businessId, {
        name: command.name,
        timezone: command.timezone,
      });

      this.logger.info("business updated", { tenantId, businessId });

      return updated;
    });
  }
}
