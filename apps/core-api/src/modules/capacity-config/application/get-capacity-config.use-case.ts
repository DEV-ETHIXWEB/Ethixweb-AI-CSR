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
  /**
   * The business's real display name, read alongside the capacity row
   * because voice-orchestrator already fetches this endpoint once at call
   * start and had nowhere else to learn it. Until this existed the AI
   * genuinely did not know which company it was answering for: both agent
   * profile providers hardcoded "the office", and the platform prompt's
   * own disclosure example carried a literal "[the business]" placeholder
   * that the model then spoke aloud. Null only if the business row is
   * missing, which the callers render as a neutral fallback rather than
   * failing a live call over.
   */
  businessName: string | null;
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
  businessName: string | null,
): CapacityConfigResult {
  if (!row) {
    return {
      id: null,
      tenantId,
      businessId,
      businessName,
      ...PLATFORM_DEFAULT_CAPACITY_CONFIG,
      createdAt: null,
      updatedAt: null,
    };
  }
  return {
    id: row.id,
    tenantId: row.tenantId,
    businessId: row.businessId,
    businessName,
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

async function findBusinessName(db: unknown, businessId: string): Promise<string | null> {
  try {
    const client = db as {
      business?: {
        findUnique(args: unknown): Promise<{ name: string } | null>;
      };
    };
    const business = await client.business?.findUnique({
      where: { id: businessId },
      select: { name: true },
    });
    return business?.name ?? null;
  } catch {
    return null;
  }
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
    const { row, businessName } = await this.tenantContext.run(tenantId, async (db) => ({
      row: await this.capacityConfigRepository.findByBusiness(db, tenantId, businessId),
      // Same tenant context, same round trip window — RLS scopes this to
      // the caller's own tenant exactly as it does the capacity row.
      //
      // Swallowed on failure rather than propagated, deliberately: this
      // endpoint is on voice-orchestrator's call-start path, and a name
      // lookup failing is a cosmetic problem (the AI says "the office"
      // instead of the company name) while throwing here would drop a
      // live inbound call. Same "degrade, never block the call" posture
      // as HttpAgentProfileProvider's own knowledge fetch.
      businessName: await findBusinessName(db, businessId),
    }));
    return toResult(tenantId, businessId, row, businessName);
  }
}
