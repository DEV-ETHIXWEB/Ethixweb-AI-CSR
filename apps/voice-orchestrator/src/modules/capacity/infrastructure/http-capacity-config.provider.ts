import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  CORE_API_CLIENT,
  type CoreApiClientPort,
} from "../../tool-broker/domain/ports/core-api-client.port";
import type {
  BrochureSegment,
  CapacityConfig,
  CapacityConfigProvider,
} from "../domain/capacity-config";
import {
  DEFAULT_BROCHURE_ROTATION_INTERVAL_MS,
  DEFAULT_EMERGENCY_HEADROOM_RATIO,
  DEFAULT_MAX_GLOBAL_CONCURRENT_CALLS,
  DEFAULT_MAX_TENANT_CONCURRENT_CALLS,
  DEFAULT_MAX_WAITING_CALLERS,
  DEFAULT_WAITING_TIMEOUT_MS,
} from "./static-capacity-config.provider";

/** core-api's `GET /internal/capacity-config/:businessId` response shape (capacity-config module's CapacityConfigResponseDto, core-api repo). */
interface CapacityConfigApiResponse {
  maxTenantConcurrentCalls?: number;
  maxWaitingCallers?: number;
  waitingTimeoutMs?: number;
  emergencyHeadroomRatio?: number;
  overflowNumber?: string | null;
  brochureEnabled?: boolean;
  brochureRotationMs?: number;
}

/** core-api's `GET /internal/knowledge/:businessId/waiting-brochure` response shape (knowledge module's WaitingBrochureItemResponseDto[], core-api repo). */
interface WaitingBrochureItemApiResponse {
  id: string;
  text: string;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * The real seam StaticCapacityConfigProvider's own comment names: core-api
 * now exposes per-tenant/business capacity policy
 * (`GET /internal/capacity-config/:businessId`, capacity-config module) and
 * the approved waiting-brochure knowledge items
 * (`GET /internal/knowledge/:businessId/waiting-brochure`, knowledge
 * module) — this provider is the swap StaticCapacityConfigProvider's own
 * comment anticipated.
 *
 * `maxGlobalConcurrentCalls` has NO core-api source (TenantCapacityConfig
 * carries no cross-tenant platform ceiling — that's a deliberate per-
 * business vs. cross-tenant distinction, see capacity-config.ts's own
 * comment) — it stays exactly the same env-var-driven default logic
 * StaticCapacityConfigProvider already uses for this one field.
 *
 * `businessName` for the brochure: core-api's capacity-config response
 * doesn't carry a business name, and fetching one would require a THIRD
 * HTTP call (e.g. to the tenants/businesses module) on top of the two this
 * provider already makes on every call-start hot path. Kept as the same
 * `"the office"` fallback StaticCapacityConfigProvider already uses —
 * a deliberate, documented simplification, not an oversight.
 *
 * CRITICAL: this sits on StartConversationUseCase's hot path, called on
 * EVERY call start. A core-api outage must never throw out of this
 * provider and must never block call admission — both HTTP calls
 * (capacity-config, brochure) are caught INDEPENDENTLY, not under one
 * outer try/catch, so a brochure-fetch failure alone degrades only the
 * brochure (falls back to the static empty/disabled brochure), never the
 * actually-important capacity limits when those loaded successfully.
 */
@Injectable()
export class HttpCapacityConfigProvider implements CapacityConfigProvider {
  private readonly logger = new Logger(HttpCapacityConfigProvider.name);

  constructor(@Inject(CORE_API_CLIENT) private readonly coreApiClient: CoreApiClientPort) {}

  async getActiveConfig(tenantId: string, businessId: string): Promise<CapacityConfig> {
    const capacity = await this.fetchCapacityConfig(tenantId, businessId);
    const brochure = await this.fetchBrochure(tenantId, businessId, capacity.brochureEnabled);

    return {
      tenantId,
      businessId,
      maxGlobalConcurrentCalls: envInt(
        "MAX_GLOBAL_CONCURRENT_CALLS",
        DEFAULT_MAX_GLOBAL_CONCURRENT_CALLS,
      ),
      maxTenantConcurrentCalls: capacity.maxTenantConcurrentCalls,
      maxWaitingCallers: capacity.maxWaitingCallers,
      waitingTimeoutMs: capacity.waitingTimeoutMs,
      overflowNumber: capacity.overflowNumber,
      emergencyHeadroomRatio: capacity.emergencyHeadroomRatio,
      brochure,
    };
  }

  private async fetchCapacityConfig(
    tenantId: string,
    businessId: string,
  ): Promise<{
    maxTenantConcurrentCalls: number;
    maxWaitingCallers: number;
    waitingTimeoutMs: number;
    emergencyHeadroomRatio: number;
    overflowNumber: string | null;
    brochureEnabled: boolean;
  }> {
    try {
      const response = await this.coreApiClient.get<CapacityConfigApiResponse>(
        `/internal/capacity-config/${businessId}`,
      );
      return {
        maxTenantConcurrentCalls:
          response.maxTenantConcurrentCalls ??
          envInt("MAX_TENANT_CONCURRENT_CALLS", DEFAULT_MAX_TENANT_CONCURRENT_CALLS),
        maxWaitingCallers:
          response.maxWaitingCallers ?? envInt("MAX_WAITING_CALLS", DEFAULT_MAX_WAITING_CALLERS),
        waitingTimeoutMs:
          response.waitingTimeoutMs ??
          envInt("CAPACITY_RESERVATION_TIMEOUT", DEFAULT_WAITING_TIMEOUT_MS),
        emergencyHeadroomRatio: response.emergencyHeadroomRatio ?? DEFAULT_EMERGENCY_HEADROOM_RATIO,
        overflowNumber: response.overflowNumber ?? process.env["CAPACITY_OVERFLOW_NUMBER"] ?? null,
        brochureEnabled: response.brochureEnabled ?? false,
      };
    } catch (error) {
      // Same env-var overrides as the happy-path fallback above — a core-api
      // outage must still honor an operator's MAX_TENANT_CONCURRENT_CALLS/
      // MAX_WAITING_CALLS/CAPACITY_RESERVATION_TIMEOUT overrides, matching
      // StaticCapacityConfigProvider's exact behavior (this class replaced
      // it as the default binding but must not silently drop the env-var
      // override contract operators/tests already rely on).
      this.logger.warn(
        `core-api capacity-config fetch failed for tenant=${tenantId} business=${businessId}, falling back to platform defaults: ${String(error)}`,
      );
      return {
        maxTenantConcurrentCalls: envInt(
          "MAX_TENANT_CONCURRENT_CALLS",
          DEFAULT_MAX_TENANT_CONCURRENT_CALLS,
        ),
        maxWaitingCallers: envInt("MAX_WAITING_CALLS", DEFAULT_MAX_WAITING_CALLERS),
        waitingTimeoutMs: envInt("CAPACITY_RESERVATION_TIMEOUT", DEFAULT_WAITING_TIMEOUT_MS),
        emergencyHeadroomRatio: DEFAULT_EMERGENCY_HEADROOM_RATIO,
        overflowNumber: process.env["CAPACITY_OVERFLOW_NUMBER"] ?? null,
        brochureEnabled: false,
      };
    }
  }

  /**
   * Caught independently from fetchCapacityConfig — a brochure-fetch
   * failure falls back to an empty/disabled brochure ONLY, never
   * re-degrading the (possibly already successfully fetched) capacity
   * limits.
   */
  private async fetchBrochure(
    tenantId: string,
    businessId: string,
    brochureEnabled: boolean,
  ): Promise<CapacityConfig["brochure"]> {
    try {
      const items = await this.coreApiClient.get<WaitingBrochureItemApiResponse[]>(
        `/internal/knowledge/${businessId}/waiting-brochure`,
      );
      const segments: BrochureSegment[] = (items ?? []).map((item) => ({
        id: item.id,
        text: item.text,
      }));
      return {
        enabled: brochureEnabled,
        businessName: "the office",
        segments,
        rotationIntervalMs: DEFAULT_BROCHURE_ROTATION_INTERVAL_MS,
      };
    } catch (error) {
      this.logger.warn(
        `core-api waiting-brochure fetch failed for tenant=${tenantId} business=${businessId}, falling back to an empty brochure: ${String(error)}`,
      );
      return {
        enabled: false,
        businessName: "the office",
        segments: [],
        rotationIntervalMs: DEFAULT_BROCHURE_ROTATION_INTERVAL_MS,
      };
    }
  }
}
