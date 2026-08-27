import { randomUUID } from "node:crypto";
import type { TenantCapacityConfig } from "../../domain/tenant-capacity-config.entity";
import type {
  CapacityConfigRepository,
  Db,
  UpsertCapacityConfigInput,
} from "../../domain/ports/capacity-config-repository.port";

const PLATFORM_DEFAULTS = {
  maxTenantConcurrentCalls: 10,
  maxWaitingCallers: 5,
  waitingTimeoutMs: 30000,
  emergencyHeadroomRatio: 0.2,
  overflowNumber: null as string | null,
  brochureEnabled: false,
  brochureRotationMs: 15000,
};

/** Keyed by businessId (matching the real `@unique` businessId column), but every lookup/write also checks tenantId — a business row belonging to a different tenant is invisible, the same tenant-scoping discipline every other fake repository in this codebase enforces. */
export class FakeCapacityConfigRepository implements CapacityConfigRepository {
  private readonly rows = new Map<string, TenantCapacityConfig>();

  async findByBusiness(
    _db: Db,
    tenantId: string,
    businessId: string,
  ): Promise<TenantCapacityConfig | null> {
    const row = this.rows.get(businessId);
    return row && row.tenantId === tenantId ? row : null;
  }

  async upsert(
    _db: Db,
    tenantId: string,
    businessId: string,
    patch: UpsertCapacityConfigInput,
  ): Promise<TenantCapacityConfig> {
    const existing = this.rows.get(businessId);
    if (existing && existing.tenantId !== tenantId) {
      // A row exists for this businessId but belongs to a different
      // tenant — never visible/writable cross-tenant, mirrors the real
      // unique-businessId-column + tenant-scoped-transaction behavior.
      throw new Error(
        `FakeCapacityConfigRepository.upsert: business ${businessId} belongs to a different tenant`,
      );
    }
    const now = new Date();
    const updated: TenantCapacityConfig = existing
      ? {
          ...existing,
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
          ...(patch.brochureEnabled !== undefined
            ? { brochureEnabled: patch.brochureEnabled }
            : {}),
          ...(patch.brochureRotationMs !== undefined
            ? { brochureRotationMs: patch.brochureRotationMs }
            : {}),
          updatedAt: now,
        }
      : {
          id: randomUUID(),
          tenantId,
          businessId,
          maxTenantConcurrentCalls:
            patch.maxTenantConcurrentCalls ?? PLATFORM_DEFAULTS.maxTenantConcurrentCalls,
          maxWaitingCallers: patch.maxWaitingCallers ?? PLATFORM_DEFAULTS.maxWaitingCallers,
          waitingTimeoutMs: patch.waitingTimeoutMs ?? PLATFORM_DEFAULTS.waitingTimeoutMs,
          emergencyHeadroomRatio:
            patch.emergencyHeadroomRatio ?? PLATFORM_DEFAULTS.emergencyHeadroomRatio,
          overflowNumber: patch.overflowNumber ?? PLATFORM_DEFAULTS.overflowNumber,
          brochureEnabled: patch.brochureEnabled ?? PLATFORM_DEFAULTS.brochureEnabled,
          brochureRotationMs: patch.brochureRotationMs ?? PLATFORM_DEFAULTS.brochureRotationMs,
          createdAt: now,
          updatedAt: now,
        };
    this.rows.set(businessId, updated);
    return updated;
  }

  /** Test helper — seed a row directly, bypassing `upsert`. */
  seed(row: TenantCapacityConfig): void {
    this.rows.set(row.businessId, row);
  }
}
