import { Inject, Injectable } from "@nestjs/common";
import type { StructuredLogger } from "@ethixweb/shared-kernel";
import { APP_LOGGER } from "../../../shared/observability/app-logger.module";
import { tenantsCreatedCounter } from "../../../shared/observability/metrics";
import { setSpanAttributes } from "../../../shared/observability/tracing";
import { PrismaService } from "../../../shared/prisma/prisma.service";
import { TENANT_REPOSITORY, type TenantRepository } from "../domain/ports/tenant-repository.port";
import type { Tenant } from "../domain/tenant.entity";

export interface CreateTenantCommand {
  name: string;
  planTier?: string;
}

/** docs/15-tenant-lifecycle-billing-and-analytics.md §1, onboarding flow step 1. */
@Injectable()
export class CreateTenantUseCase {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(TENANT_REPOSITORY) private readonly tenantRepository: TenantRepository,
    @Inject(APP_LOGGER) private readonly logger: StructuredLogger,
  ) {}

  async execute(command: CreateTenantCommand): Promise<Tenant> {
    const tenant = await this.tenantRepository.create(this.prisma, {
      name: command.name,
      planTier: command.planTier,
    });

    setSpanAttributes({ "ethixweb.tenant_id": tenant.id });
    tenantsCreatedCounter.add(1, { plan_tier: tenant.planTier });
    this.logger.info("tenant created", { tenantId: tenant.id, planTier: tenant.planTier });

    return tenant;
  }
}
