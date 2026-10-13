/**
 * The orchestrator's view of per-tenant/global capacity policy. Same seam
 * as `AgentProfile`/`AgentProfileProvider` (modules/prompt/domain/agent-profile.ts)
 * — a READ-shaped projection this service consumes, not the entity's
 * persistence/CRUD lifecycle (that belongs to core-api, tenant/business
 * scoped Postgres data, this service is deliberately Postgres-free). See
 * StaticCapacityConfigProvider's own comment for what's wired today vs.
 * deferred behind this port.
 *
 * No limit value here is invented. `maxGlobalConcurrentCalls` and
 * `maxTenantConcurrentCalls` are operator-set ceilings — this codebase has
 * no live measurement of actual LLM/STT/TTS/Voice-Runtime vendor capacity
 * to derive a "correct" default from (confirmed by audit: no concurrency
 * control exists anywhere in the AI-provider adapters today), so the
 * static defaults below are deliberately conservative placeholders, not
 * capacity claims — see docs/36 §1's explicit "do not invent limits" note.
 */
export interface CapacityConfig {
  tenantId: string;
  businessId: string;
  /**
   * The business's real display name, from core-api. Carried on this
   * config because it is already fetched once per call start and the
   * prompt layer had no other source: until this existed the AI was never
   * told which company it was answering for. Null when core-api is
   * degraded or the business row is missing, which prompt assembly
   * renders as a neutral fallback rather than a spoken placeholder.
   */
  businessName: string | null;
  /** Hard ceiling across ALL tenants sharing this deployment. */
  maxGlobalConcurrentCalls: number;
  /** Hard ceiling for this tenant alone — never allows one tenant to starve another. */
  maxTenantConcurrentCalls: number;
  /** How many callers may be held in the short waiting/brochure experience before overflow triggers. */
  maxWaitingCallers: number;
  /** How long (ms) a waiting caller may remain before overflow triggers — matches CAPACITY_RESERVATION_TIMEOUT's role for the reservation itself. */
  waitingTimeoutMs: number;
  /** E.164 destination for human/overflow handoff when capacity cannot be found in time. Null = no configured overflow (see docs/36 §9's "do not simply disconnect" handling). */
  overflowNumber: string | null;
  /** Fraction (0-1) of maxTenantConcurrentCalls reserved as headroom so an emergency call is more likely to find capacity — see docs/36 §5's honest limits on what "priority" can mean before a call is admitted. */
  emergencyHeadroomRatio: number;
  brochure: VoiceBrochureConfig;
}

/**
 * Tenant-approved marketing content ONLY — the AI/waiting experience must
 * never speak anything not explicitly present here (docs/36 §5's "AI MUST
 * NOT invent" list: years in business, certifications, prices, guarantees,
 * awards, service availability/areas beyond what's configured).
 */
export interface VoiceBrochureConfig {
  enabled: boolean;
  businessName: string;
  /** Each entry is one short (10-20s spoken) rotation segment — never one long pitch. */
  segments: readonly BrochureSegment[];
  /** ms between rotating to the next segment while a caller is genuinely waiting. */
  rotationIntervalMs: number;
}

export interface BrochureSegment {
  id: string;
  text: string;
}

export interface CapacityConfigProvider {
  getActiveConfig(tenantId: string, businessId: string): Promise<CapacityConfig>;
}

export const CAPACITY_CONFIG_PROVIDER = Symbol("CAPACITY_CONFIG_PROVIDER");
