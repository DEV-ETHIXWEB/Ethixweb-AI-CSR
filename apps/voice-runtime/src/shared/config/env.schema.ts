import { z } from "zod";

/**
 * Fail at boot, not mid-call — identical discipline to
 * apps/voice-orchestrator/src/shared/config/env.schema.ts (read directly
 * before writing this). Every required var below already has a runtime
 * `process.env["X"]` read that would otherwise throw/degrade the first time
 * a real call exercises it (Twilio signature verification, the
 * orchestrator HTTP client, Deepgram/ElevenLabs sessions) — wiring this
 * through `ConfigModule.forRoot({ validate })` turns a missing secret into
 * a bootstrap crash a deployer sees immediately, not a mid-call failure a
 * real caller is waiting on.
 *
 * TWILIO_AUTH_TOKEN here is intentionally this service's OWN credential,
 * never shared with apps/core-api's same-named var (docs/39 §"Required
 * environment variables" is explicit: core-api's copy is for the unrelated
 * outbound-SMS-notification feature). Two separate Twilio "products"
 * (Voice vs. programmable SMS) commonly sit under different Twilio
 * sub-accounts even for the same business — conflating the env var names
 * across services would make that impossible to represent.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3200),
  /** Public HTTPS base URL this service is reachable at (ngrok in dev, ALB/CloudFront in prod) — used to build the Media Stream WebSocket URL embedded in outgoing TwiML. */
  PUBLIC_BASE_URL: z.string().min(1, "PUBLIC_BASE_URL is required"),

  VOICE_ORCHESTRATOR_BASE_URL: z.string().min(1, "VOICE_ORCHESTRATOR_BASE_URL is required"),
  ORCHESTRATOR_SERVICE_TOKEN: z.string().min(1, "ORCHESTRATOR_SERVICE_TOKEN is required"),

  // This service's OWN Twilio Voice credentials — never apps/core-api's
  // TWILIO_AUTH_TOKEN (outbound SMS, an unrelated feature/sub-account per
  // docs/39). TWILIO_AUTH_TOKEN doubles as the TwilioSignatureGuard secret
  // AND the Twilio REST API basic-auth password, matching Twilio's own
  // credential model (one auth token per account/sub-account).
  TWILIO_ACCOUNT_SID: z.string().min(1, "TWILIO_ACCOUNT_SID is required"),
  TWILIO_AUTH_TOKEN: z.string().min(1, "TWILIO_AUTH_TOKEN is required"),
  /** E.164. Informational/validation only today — TenantRoutingProvider reads toNumber per-request, not this var; kept for parity with docs/28 §B.1's "resolve tenantId/businessId from toNumber" and so a deployer has one place confirming which number this deployment expects inbound calls on. */
  TWILIO_PHONE_NUMBER: z.string().min(1, "TWILIO_PHONE_NUMBER is required"),
  /**
   * Skips X-Twilio-Signature verification — for local ngrok testing only,
   * where Twilio's signature is computed against the ngrok URL but this
   * process may sit behind additional local proxying that alters headers
   * unpredictably. Mirrors the honesty requirement in
   * TwilioSignatureGuard's own core-api comment: never default this to
   * true, never allow it in production (enforced in the guard itself, not
   * just documented here).
   */
  TWILIO_SIGNATURE_VALIDATION_DISABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),

  DEEPGRAM_API_KEY: z.string().min(1, "DEEPGRAM_API_KEY is required"),
  DEEPGRAM_MODEL: z.string().optional(),

  ELEVENLABS_API_KEY: z.string().min(1, "ELEVENLABS_API_KEY is required"),
  ELEVENLABS_VOICE_ID: z.string().min(1, "ELEVENLABS_VOICE_ID is required"),
  ELEVENLABS_MODEL_ID: z.string().optional(),

  /**
   * StaticTenantRoutingProvider's source of truth (infrastructure/static-tenant-routing.provider.ts)
   * — JSON array of {toNumber, tenantId, businessId, timezone}. A real
   * per-tenant DB-backed lookup is future work, flagged the same honest way
   * StaticAgentProfileProvider flags its own deferred work in
   * voice-orchestrator. Optional at the schema level so a single-tenant
   * deployment can instead set the TENANT_ROUTING_DEFAULT_* vars below;
   * StaticTenantRoutingProvider itself throws a clear error at call time if
   * NEITHER is configured and a call arrives.
   */
  TENANT_ROUTING_MAP: z.string().optional(),
  TENANT_ROUTING_DEFAULT_TENANT_ID: z.string().optional(),
  TENANT_ROUTING_DEFAULT_BUSINESS_ID: z.string().optional(),
  TENANT_ROUTING_DEFAULT_TIMEZONE: z.string().optional(),

  LOG_LEVEL: z.string().optional(),
  OTEL_SERVICE_NAME: z.string().optional(),
  OTEL_SDK_DISABLED: z.string().optional(),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),

  /**
   * The operational kill switch — docs/19-operational-runbooks.md's
   * "disable AI receptionist / forward to human" runbook is this variable.
   * Previously a genuine, documented gap (docs/29-phase11-12-blocker-resolution.md
   * Blocker 5: "no repo-level kill switch tooling exists yet; today this
   * would be a manual telephony-routing change on Yash's side") — closed
   * here now that voice-runtime is this repo's own service, not an
   * external one this codebase has no control over. Default `true` (AI
   * handles the call normally) so this is opt-in-to-disable, never
   * opt-in-to-enable-by-accident. When `false`, TwilioVoiceController skips
   * tenant resolution and the entire AI/media-stream path entirely and
   * returns `<Dial>` TwiML straight to HUMAN_FALLBACK_NUMBER — the fastest,
   * lowest-risk path back to "the phone still works" during an incident,
   * requiring only an env var change + restart, not a deploy or a Twilio
   * Console change.
   */
  AI_RECEPTIONIST_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  /** Required (checked below, not by the field type alone) when AI_RECEPTIONIST_ENABLED=false — the E.164 number/queue every inbound call is unconditionally forwarded to instead. */
  HUMAN_FALLBACK_NUMBER: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

/**
 * The `validate` function `@nestjs/config`'s `ConfigModule.forRoot` calls
 * with the raw `process.env` — thrown errors here abort Nest's bootstrap
 * before any module is instantiated, identical contract to
 * voice-orchestrator's own `validate`.
 */
export function validate(config: Record<string, unknown>): Env {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    throw new Error(`Invalid environment configuration:\n${result.error.toString()}`);
  }
  if (!result.data.AI_RECEPTIONIST_ENABLED && !result.data.HUMAN_FALLBACK_NUMBER) {
    throw new Error(
      "Invalid environment configuration:\nHUMAN_FALLBACK_NUMBER is required when AI_RECEPTIONIST_ENABLED=false — the kill switch must always have a real destination to forward to.",
    );
  }
  return result.data;
}
