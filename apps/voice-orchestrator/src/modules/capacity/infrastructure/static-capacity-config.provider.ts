import { Injectable } from "@nestjs/common";
import type { CapacityConfig, CapacityConfigProvider } from "../domain/capacity-config";

// Exported (not module-private) so HttpCapacityConfigProvider can import
// and reuse the SAME literals for its own core-api-unreachable fallback,
// rather than duplicating these numbers a second place and risking drift.
export const DEFAULT_MAX_GLOBAL_CONCURRENT_CALLS = 100;
export const DEFAULT_MAX_TENANT_CONCURRENT_CALLS = 10;
export const DEFAULT_MAX_WAITING_CALLERS = 5;
export const DEFAULT_WAITING_TIMEOUT_MS = 30_000;
export const DEFAULT_EMERGENCY_HEADROOM_RATIO = 0.2;
export const DEFAULT_BROCHURE_ROTATION_INTERVAL_MS = 15_000;

/**
 * TECHNICAL DEBT, flagged deliberately rather than hidden — same posture
 * as StaticAgentProfileProvider (modules/prompt/infrastructure), whose own
 * comment this one mirrors: no core-api module exposes per-tenant capacity
 * or brochure configuration yet (there is no `capacity_configs` or
 * `voice_brochures` table — building full CRUD/versioning for one is out
 * of scope here, matching the same "only the orchestrator" instruction
 * that scoped StaticAgentProfileProvider originally). This provider
 * returns env-configured GLOBAL defaults (or platform fallbacks) for every
 * tenant, not real per-tenant values — swap this class for an HTTP client
 * against a future `GET /internal/capacity-configs/active` endpoint once
 * core-api exposes one; `CapacityConfigProvider` is the seam designed in
 * for exactly that swap.
 *
 * The numeric ceilings below are NOT derived from any measured LLM/STT/TTS/
 * Voice-Runtime vendor capacity — none exists to measure in this
 * environment (confirmed by direct audit: no concurrency control exists
 * anywhere in the AI-provider adapters). They are conservative operator
 * defaults, overridable via env vars using the requested naming
 * convention, and MUST be tuned against real measured capacity before
 * relying on them in production — see docs/36 §1's explicit "do not claim
 * real provider capacity until the live runtime exists."
 *
 * No longer the default `CAPACITY_CONFIG_PROVIDER` binding (see
 * CapacityModule) — HttpCapacityConfigProvider is, now that core-api
 * exposes `GET /internal/capacity-config/:businessId` and
 * `GET /internal/knowledge/:businessId/waiting-brochure`. Retained as the
 * fallback this class's own defaults feed into on a core-api outage, and
 * as a test double.
 */
@Injectable()
export class StaticCapacityConfigProvider implements CapacityConfigProvider {
  async getActiveConfig(tenantId: string, businessId: string): Promise<CapacityConfig> {
    return {
      tenantId,
      businessId,
      maxGlobalConcurrentCalls: envInt(
        "MAX_GLOBAL_CONCURRENT_CALLS",
        DEFAULT_MAX_GLOBAL_CONCURRENT_CALLS,
      ),
      maxTenantConcurrentCalls: envInt(
        "MAX_TENANT_CONCURRENT_CALLS",
        DEFAULT_MAX_TENANT_CONCURRENT_CALLS,
      ),
      maxWaitingCallers: envInt("MAX_WAITING_CALLS", DEFAULT_MAX_WAITING_CALLERS),
      waitingTimeoutMs: envInt("CAPACITY_RESERVATION_TIMEOUT", DEFAULT_WAITING_TIMEOUT_MS),
      overflowNumber: process.env["CAPACITY_OVERFLOW_NUMBER"] ?? null,
      emergencyHeadroomRatio: DEFAULT_EMERGENCY_HEADROOM_RATIO,
      brochure: {
        enabled: false,
        businessName: "the office",
        segments: [],
        rotationIntervalMs: DEFAULT_BROCHURE_ROTATION_INTERVAL_MS,
      },
    };
  }
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
