import { Inject, Injectable } from "@nestjs/common";
import { setSpanAttributes } from "../../../shared/observability/tracing";
import { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import type { TenantCapacityConfig } from "../domain/tenant-capacity-config.entity";
import {
  CAPACITY_CONFIG_REPOSITORY,
  type CapacityConfigRepository,
} from "../domain/ports/capacity-config-repository.port";

/**
 * Matches the Prisma schema's own `@default(...)` values for
 * TenantCapacityConfig EXACTLY (packages/database/prisma/schema.prisma) —
 * so "no row configured yet" and "a row exists with every field left at
 * its default" are observably identical to every caller, the same
 * "absence = defaults" contract voice-orchestrator's
 * StaticCapacityConfigProvider already documents for ITS fallback values.
 */
export const PLATFORM_DEFAULT_CAPACITY_CONFIG = {
  maxTenantConcurrentCalls: 10,
  maxWaitingCallers: 5,
  waitingTimeoutMs: 30000,
  emergencyHeadroomRatio: 0.2,
  overflowNumber: null as string | null,
  brochureEnabled: false,
  brochureRotationMs: 15000,
} as const;

/**
 * Returned when no `TenantCapacityConfig` row exists for the business yet.
 * Same field set as `TenantCapacityConfig` minus the DB-only bookkeeping
 * fields (`id`/`createdAt`/`updatedAt`, all null here since there is no
 * real row) — chosen over a plain union return type
 * (`TenantCapacityConfig | PlatformDefaults`) so every caller (both the
 * dashboard controller and voice-orchestrator's HttpCapacityConfigProvider)
 * gets ONE consistent shape without a null-check/discriminate step for
 * every field individually; `tenantId`/`businessId` are still filled in
 * from the query params so the response is self-describing either way.
 */
export interface CapacityConfigResult {
  id: string | null;
  tenantId: string;
  businessId: string;
  maxTenantConcurrentCalls: number;
  maxWaitingCallers: number;
  waitingTimeoutMs: number;
  emergencyHeadroomRatio: number;
  overflowNumber: string | null;
  brochureEnabled: boolean;
  brochureRotationMs: number;
  createdAt: Date | null;
  updatedAt: Date | null;
}

function toResult(
  tenantId: string,
  businessId: string,
  row: TenantCapacityConfig | null,
): CapacityConfigResult {
  if (!row) {
    return {
      id: null,
      tenantId,
      businessId,
      ...PLATFORM_DEFAULT_CAPACITY_CONFIG,
      createdAt: null,
      updatedAt: null,
    };
  }
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

/** Never throws 404 for a missing row — absence means "use platform defaults," the deliberate contract this endpoint exists to serve (see PLATFORM_DEFAULT_CAPACITY_CONFIG's own comment). */
@Injectable()
export class GetCapacityConfigUseCase {
  constructor(
    private readonly tenantContext: TenantContextService,
    @Inject(CAPACITY_CONFIG_REPOSITORY)
    private readonly capacityConfigRepository: CapacityConfigRepository,
  ) {}

  async execute(tenantId: string, businessId: string): Promise<CapacityConfigResult> {
    setSpanAttributes({ "ethixweb.tenant_id": tenantId, "ethixweb.business_id": businessId });
    const row = await this.tenantContext.run(tenantId, (db) =>
      this.capacityConfigRepository.findByBusiness(db, tenantId, businessId),
    );
    return toResult(tenantId, businessId, row);
  }
}
