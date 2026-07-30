import { Inject, Injectable } from "@nestjs/common";
import type { StructuredLogger } from "@ethixweb/shared-kernel";
import type { TenantStatus } from "@ethixweb/database";
import { APP_LOGGER } from "../../../shared/observability/app-logger.module";
import { tenantStatusTransitionsCounter } from "../../../shared/observability/metrics";
import { setSpanAttributes } from "../../../shared/observability/tracing";
import { PrismaService } from "../../../shared/prisma/prisma.service";
import { TenantNotFoundError } from "../domain/errors";
import { TENANT_REPOSITORY, type TenantRepository } from "../domain/ports/tenant-repository.port";
import { assertValidTenantStatusTransition } from "../domain/tenant-lifecycle";
import type { Tenant } from "../domain/tenant.entity";

/** docs/15-tenant-lifecycle-billing-and-analytics.md §2 state machine. */
@Injectable()
export class TransitionTenantStatusUseCase {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(TENANT_REPOSITORY) private readonly tenantRepository: TenantRepository,
    @Inject(APP_LOGGER) private readonly logger: StructuredLogger,
  ) {}

  async execute(tenantId: string, toStatus: TenantStatus): Promise<Tenant> {
    setSpanAttributes({ "ethixweb.tenant_id": tenantId });

    const tenant = await this.tenantRepository.findById(this.prisma, tenantId);
    if (!tenant) {
      throw new TenantNotFoundError(tenantId);
    }
    assertValidTenantStatusTransition(tenant.status, toStatus);

    // Passing tenant.status as `fromStatus` lets the repository detect (and
    // reject) a concurrent transition that already moved this tenant away
    // from the status just validated against — see updateStatus's own
    // comment on the write-write race this closes.
    const updated = await this.tenantRepository.updateStatus(
      this.prisma,
      tenantId,
      tenant.status,
      toStatus,
    );

    tenantStatusTransitionsCounter.add(1, { from_status: tenant.status, to_status: toStatus });
    // A lifecycle transition (Active -> Suspended especially) is a
    // business-significant event on its own, worth an info-level log
    // independent of whatever triggered it (billing webhook, admin action,
    // support ticket) — distinct from a routine read, which isn't.
    this.logger.info("tenant status transitioned", {
      tenantId,
      fromStatus: tenant.status,
      toStatus,
    });

    return updated;
  }
}
