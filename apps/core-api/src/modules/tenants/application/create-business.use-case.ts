import { Inject, Injectable } from "@nestjs/common";
import type { StructuredLogger } from "@ethixweb/shared-kernel";
import { APP_LOGGER } from "../../../shared/observability/app-logger.module";
import { businessesCreatedCounter } from "../../../shared/observability/metrics";
import { setSpanAttributes } from "../../../shared/observability/tracing";
import { PrismaService } from "../../../shared/prisma/prisma.service";
import { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import type { Business } from "../domain/business.entity";
import { TenantNotFoundError } from "../domain/errors";
import {
  BUSINESS_REPOSITORY,
  type BusinessRepository,
} from "../domain/ports/business-repository.port";
import { TENANT_REPOSITORY, type TenantRepository } from "../domain/ports/tenant-repository.port";

export interface CreateBusinessCommand {
  tenantId: string;
  name: string;
  timezone: string;
  crmType: string;
}

@Injectable()
export class CreateBusinessUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    @Inject(TENANT_REPOSITORY) private readonly tenantRepository: TenantRepository,
    @Inject(BUSINESS_REPOSITORY) private readonly businessRepository: BusinessRepository,
    @Inject(APP_LOGGER) private readonly logger: StructuredLogger,
  ) {}

  async execute(command: CreateBusinessCommand): Promise<Business> {
    setSpanAttributes({ "ethixweb.tenant_id": command.tenantId });

    // `tenants` has no RLS policy (docs/20 ADR-013), so this existence check
    // runs against the plain client, outside any tenant-scoped transaction.
    const tenant = await this.tenantRepository.findById(this.prisma, command.tenantId);
    if (!tenant) {
      throw new TenantNotFoundError(command.tenantId);
    }

    const business = await this.tenantContext.run(command.tenantId, (db) =>
      this.businessRepository.create(db, {
        tenantId: command.tenantId,
        name: command.name,
        timezone: command.timezone,
        crmType: command.crmType,
      }),
    );

    setSpanAttributes({ "ethixweb.business_id": business.id });
    businessesCreatedCounter.add(1, { crm_type: business.crmType });
    this.logger.info("business created", {
      tenantId: command.tenantId,
      businessId: business.id,
      crmType: business.crmType,
    });

    return business;
  }
}
