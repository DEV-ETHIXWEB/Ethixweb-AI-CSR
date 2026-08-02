/**
 * docs/26-usage-metering.md — the platform's normalized usage dimensions.
 * Not vendor-specific ("twilio_minutes") — `usageType` is what's measured,
 * `source` (a free-form string on the entity, not this enum) is who
 * measured it, so a vendor swap (e.g. Deepgram -> another STT provider)
 * never requires a new usage type, only a new `source` value.
 */
export const USAGE_TYPES = [
  "voice_call_duration",
  "llm_tokens",
  "stt_duration",
  "tts_characters",
  "telephony_minutes",
  "sms_message",
  "notification_sent",
  "crm_api_call",
] as const;
export type UsageType = (typeof USAGE_TYPES)[number];

/** The unit `quantity` is denominated in — informational, never inferred from `usageType` at read time, since a given usage type's unit is a real design decision, not a formatting detail. */
export const USAGE_UNITS = [
  "seconds",
  "minutes",
  "tokens",
  "characters",
  "messages",
  "count",
] as const;
export type UsageUnit = (typeof USAGE_UNITS)[number];

export interface UsageRecord {
  id: string;
  tenantId: string;
  businessId: string;
  /** Voice Runtime/orchestrator call identifier — correlation only, not a foreign key (see prisma/schema.prisma's UsageRecord comment for why). */
  callId: string | null;
  leadId: string | null;
  usageType: UsageType;
  /** Free-form provider/component identifier (e.g. "twilio", "deepgram", "openai:gpt-4o") — never used for pricing, only correlation/observability. */
  source: string;
  /** Integer, never a float — exact measured units, no fractional-cent rounding concerns at this layer (docs/26 §9's monetary-precision discussion applies to money, not raw usage quantity). */
  quantity: number;
  unit: UsageUnit;
  /** Informational only — this platform's OWN vendor cost estimate, never what a tenant is billed (docs/26 §10, docs/15 §3.1). */
  estimatedProviderCostUsd: string | null;
  dedupKey: string;
  metadata: Record<string, unknown>;
  occurredAt: string;
  createdAt: string;
}
