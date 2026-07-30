import { Inject, Injectable } from "@nestjs/common";
import type { StructuredLogger } from "@ethixweb/shared-kernel";
import { APP_LOGGER } from "../../../shared/observability/app-logger.module";
import { setSpanAttributes } from "../../../shared/observability/tracing";
import { PrismaService } from "../../../shared/prisma/prisma.service";
import { TenantNotFoundError } from "../domain/errors";
import { TENANT_REPOSITORY, type TenantRepository } from "../domain/ports/tenant-repository.port";
import type { Tenant } from "../domain/tenant.entity";

export interface UpdateTenantCommand {
  name: string;
}

/**
 * Name only — deliberately not `planTier`. Per
 * docs/15-tenant-lifecycle-billing-and-analytics.md §3.1, `plan_tier` is a
 * cache/mirror of Stripe's own subscription state, synced via Stripe
 * webhooks; exposing it as a freely PATCHable field here would let a
 * tenant's plan drift out of sync with what they're actually billed for.
 * That sync path is billing-module scope, not built yet, and isn't
 * scaffolded here (per the "don't scaffold future modules" instruction this
 * turn) — only the field that's unambiguously this module's to own is
 * editable.
 */
@Injectable()
export class UpdateTenantUseCase {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(TENANT_REPOSITORY) private readonly tenantRepository: TenantRepository,
    @Inject(APP_LOGGER) private readonly logger: StructuredLogger,
  ) {}

  async execute(tenantId: string, command: UpdateTenantCommand): Promise<Tenant> {
    setSpanAttributes({ "ethixweb.tenant_id": tenantId });

    const existing = await this.tenantRepository.findById(this.prisma, tenantId);
    if (!existing) {
      throw new TenantNotFoundError(tenantId);
    }

    const updated = await this.tenantRepository.update(this.prisma, tenantId, {
      name: command.name,
    });

    this.logger.info("tenant updated", { tenantId });

    return updated;
  }
}
