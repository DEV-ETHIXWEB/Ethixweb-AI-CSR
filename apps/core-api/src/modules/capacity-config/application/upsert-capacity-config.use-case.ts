import { Inject, Injectable } from "@nestjs/common";
import {
  AUDIT_LOG_REPOSITORY,
  type AuditLogRepository,
} from "../../../shared/audit/audit-log-repository.port";
import { setSpanAttributes } from "../../../shared/observability/tracing";
import { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import type { TenantCapacityConfig } from "../domain/tenant-capacity-config.entity";
import {
  CAPACITY_CONFIG_REPOSITORY,
  type CapacityConfigRepository,
  type UpsertCapacityConfigInput,
} from "../domain/ports/capacity-config-repository.port";

export interface UpsertCapacityConfigCommand {
  tenantId: string;
  businessId: string;
  actorUserId: string | null;
  patch: UpsertCapacityConfigInput;
}

@Injectable()
export class UpsertCapacityConfigUseCase {
  constructor(
    private readonly tenantContext: TenantContextService,
    @Inject(CAPACITY_CONFIG_REPOSITORY)
    private readonly capacityConfigRepository: CapacityConfigRepository,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly auditLogRepository: AuditLogRepository,
  ) {}

  async execute(command: UpsertCapacityConfigCommand): Promise<TenantCapacityConfig> {
    setSpanAttributes({
      "ethixweb.tenant_id": command.tenantId,
      "ethixweb.business_id": command.businessId,
    });

    return this.tenantContext.run(command.tenantId, async (db) => {
      // Fetched inside the SAME tenant-scoped transaction the upsert runs
      // in, so `before` reflects exactly the row state the upsert is about
      // to change (null if this is the first configuration for this
      // business) — not a separate, potentially stale read.
      const before = await this.capacityConfigRepository.findByBusiness(
        db,
        command.tenantId,
        command.businessId,
      );
      const after = await this.capacityConfigRepository.upsert(
        db,
        command.tenantId,
        command.businessId,
        command.patch,
      );

      await this.auditLogRepository.record(db, {
        tenantId: command.tenantId,
        actorId: command.actorUserId,
        actorType: "user",
        action: "capacity_config.updated",
        resourceType: "tenant_capacity_config",
        resourceId: after.id,
        before,
        after,
      });

      return after;
    });
  }
}
