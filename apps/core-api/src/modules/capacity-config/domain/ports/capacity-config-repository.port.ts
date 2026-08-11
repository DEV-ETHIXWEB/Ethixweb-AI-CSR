import type { Prisma, PrismaClient } from "@ethixweb/database";
import type { TenantCapacityConfig } from "../tenant-capacity-config.entity";

export type Db = PrismaClient | Prisma.TransactionClient;

/** A partial patch — every field optional, so a caller can update only what it means to change. On `create` (first upsert for a business), any field NOT in the patch falls back to the Prisma schema's own `@default(...)`, not a value re-derived here. */
export interface UpsertCapacityConfigInput {
  maxTenantConcurrentCalls?: number | undefined;
  maxWaitingCallers?: number | undefined;
  waitingTimeoutMs?: number | undefined;
  emergencyHeadroomRatio?: number | undefined;
  overflowNumber?: string | null | undefined;
  brochureEnabled?: boolean | undefined;
  brochureRotationMs?: number | undefined;
}

export interface CapacityConfigRepository {
  findByBusiness(
    db: Db,
    tenantId: string,
    businessId: string,
  ): Promise<TenantCapacityConfig | null>;
  /** Keyed on the unique `businessId` column — creates on first call, merges the patch onto the existing row on subsequent calls. */
  upsert(
    db: Db,
    tenantId: string,
    businessId: string,
    patch: UpsertCapacityConfigInput,
  ): Promise<TenantCapacityConfig>;
}

export const CAPACITY_CONFIG_REPOSITORY = Symbol("CAPACITY_CONFIG_REPOSITORY");
