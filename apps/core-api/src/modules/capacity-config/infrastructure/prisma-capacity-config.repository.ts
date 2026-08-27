import { Injectable } from "@nestjs/common";
import type { TenantCapacityConfig } from "../domain/tenant-capacity-config.entity";
import type {
  CapacityConfigRepository,
  Db,
  UpsertCapacityConfigInput,
} from "../domain/ports/capacity-config-repository.port";

type TenantCapacityConfigRow = {
  id: string;
  tenantId: string;
  businessId: string;
  maxTenantConcurrentCalls: number;
  maxWaitingCallers: number;
  waitingTimeoutMs: number;
  emergencyHeadroomRatio: number;
  overflowNumber: string | null;
  brochureEnabled: boolean;
  brochureRotationMs: number;
  createdAt: Date;
  updatedAt: Date;
};

function toEntity(row: TenantCapacityConfigRow): TenantCapacityConfig {
  return {
    id: row.id,
    tenantId: row.tenantId,
    businessId: row.businessId,
    maxTenantConcurrentCalls: row.maxTenantConcurrentCalls,
    maxWaitingCallers: row.maxWaitingCallers,
    waitingTimeoutMs: row.waitingTimeoutMs,
    emergencyHeadroomRatio: row.emergencyHeadroomRatio,
    overflowNumber: row.overflowNumber,
    brochureEnabled: row.brochureEnabled,
    brochureRotationMs: row.brochureRotationMs,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

@Injectable()
export class PrismaCapacityConfigRepository implements CapacityConfigRepository {
  async findByBusiness(
    db: Db,
    tenantId: string,
    businessId: string,
  ): Promise<TenantCapacityConfig | null> {
    const row = await db.tenantCapacityConfig.findFirst({ where: { tenantId, businessId } });
    return row ? toEntity(row) : null;
  }

  async upsert(
    db: Db,
    tenantId: string,
    businessId: string,
    patch: UpsertCapacityConfigInput,
  ): Promise<TenantCapacityConfig> {
    const row = await db.tenantCapacityConfig.upsert({
      where: { businessId },
      create: {
        tenantId,
        businessId,
        ...(patch.maxTenantConcurrentCalls !== undefined
          ? { maxTenantConcurrentCalls: patch.maxTenantConcurrentCalls }
          : {}),
        ...(patch.maxWaitingCallers !== undefined
          ? { maxWaitingCallers: patch.maxWaitingCallers }
          : {}),
        ...(patch.waitingTimeoutMs !== undefined
          ? { waitingTimeoutMs: patch.waitingTimeoutMs }
          : {}),
        ...(patch.emergencyHeadroomRatio !== undefined
          ? { emergencyHeadroomRatio: patch.emergencyHeadroomRatio }
          : {}),
        ...(patch.overflowNumber !== undefined ? { overflowNumber: patch.overflowNumber } : {}),
        ...(patch.brochureEnabled !== undefined ? { brochureEnabled: patch.brochureEnabled } : {}),
        ...(patch.brochureRotationMs !== undefined
          ? { brochureRotationMs: patch.brochureRotationMs }
          : {}),
      },
      update: {
        ...(patch.maxTenantConcurrentCalls !== undefined
          ? { maxTenantConcurrentCalls: patch.maxTenantConcurrentCalls }
          : {}),
        ...(patch.maxWaitingCallers !== undefined
          ? { maxWaitingCallers: patch.maxWaitingCallers }
          : {}),
        ...(patch.waitingTimeoutMs !== undefined
          ? { waitingTimeoutMs: patch.waitingTimeoutMs }
          : {}),
        ...(patch.emergencyHeadroomRatio !== undefined
          ? { emergencyHeadroomRatio: patch.emergencyHeadroomRatio }
          : {}),
        ...(patch.overflowNumber !== undefined ? { overflowNumber: patch.overflowNumber } : {}),
        ...(patch.brochureEnabled !== undefined ? { brochureEnabled: patch.brochureEnabled } : {}),
        ...(patch.brochureRotationMs !== undefined
          ? { brochureRotationMs: patch.brochureRotationMs }
          : {}),
      },
    });
    return toEntity(row);
  }
}
