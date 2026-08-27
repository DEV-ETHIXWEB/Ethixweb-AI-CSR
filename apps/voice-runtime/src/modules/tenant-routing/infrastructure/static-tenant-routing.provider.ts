import { Injectable } from "@nestjs/common";
import type { TenantRoute, TenantRoutingProvider } from "../domain/tenant-routing.port";

/**
 * TECHNICAL DEBT, flagged deliberately rather than hidden — identical
 * posture to voice-orchestrator's StaticAgentProfileProvider comment: a
 * real per-tenant, DB-backed number->tenant mapping (owned by core-api,
 * which already has tenant/business data) is future work, not built here.
 * This build's scope is the runtime's TRANSPORT (Twilio/STT/TTS/orchestrator
 * client), not a new core-api CRUD surface for phone-number provisioning.
 *
 * Two configuration modes, checked in order:
 *  1. `TENANT_ROUTING_MAP` — a JSON array of {toNumber, tenantId,
 *     businessId, timezone}, for a deployment fronting multiple numbers.
 *  2. `TENANT_ROUTING_DEFAULT_TENANT_ID`/`_BUSINESS_ID`/`_TIMEZONE` — a
 *     single-tenant deployment (the "All Phase Plumbing" pilot per
 *     docs/01 §9) where every inbound call maps to the one configured
 *     tenant regardless of which number it landed on. This is the
 *     realistic mode for the FIRST real call (docs/41) — a single Twilio
 *     number, one tenant, no lookup table needed yet.
 *
 * Swap this class for an HTTP-backed provider once core-api exposes a
 * `GET /internal/tenant-routing/:toNumber` (or equivalent) route —
 * `TenantRoutingProvider` is the seam designed in for exactly that swap.
 */
@Injectable()
export class StaticTenantRoutingProvider implements TenantRoutingProvider {
  private routes: Map<string, TenantRoute> | null = null;

  async resolve(toNumber: string): Promise<TenantRoute | null> {
    const map = this.loadRoutes();
    const exact = map.get(toNumber);
    if (exact) {
      return exact;
    }

    const defaultTenantId = process.env["TENANT_ROUTING_DEFAULT_TENANT_ID"];
    const defaultBusinessId = process.env["TENANT_ROUTING_DEFAULT_BUSINESS_ID"];
    if (defaultTenantId && defaultBusinessId) {
      return {
        tenantId: defaultTenantId,
        businessId: defaultBusinessId,
        timezone: process.env["TENANT_ROUTING_DEFAULT_TIMEZONE"],
      };
    }

    return null;
  }

  private loadRoutes(): Map<string, TenantRoute> {
    if (this.routes) {
      return this.routes;
    }
    const raw = process.env["TENANT_ROUTING_MAP"];
    const map = new Map<string, TenantRoute>();
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Array<{
          toNumber: string;
          tenantId: string;
          businessId: string;
          timezone?: string;
        }>;
        for (const entry of parsed) {
          map.set(entry.toNumber, {
            tenantId: entry.tenantId,
            businessId: entry.businessId,
            timezone: entry.timezone,
          });
        }
      } catch {
        // Malformed JSON in TENANT_ROUTING_MAP falls through to the
        // TENANT_ROUTING_DEFAULT_* fallback (or null) rather than crashing
        // the whole service — env.schema.ts deliberately leaves this var
        // unvalidated-as-JSON at boot (a zod .string() only checks it's a
        // string) because a malformed routing table for ONE number should
        // not block every other number/the default route from working.
      }
    }
    this.routes = map;
    return map;
  }
}
