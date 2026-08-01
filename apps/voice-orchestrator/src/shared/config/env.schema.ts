import { z } from "zod";

/**
 * Fail at boot, not mid-call: every required var below already has a
 * runtime `process.env["X"]` read that throws (RedisService) or degrades
 * a live voice session (ServiceAuthGuard rejecting every request,
 * HttpCoreApiClient throwing on every tool-broker call) the first time
 * it's actually exercised — see shared/redis/redis.service.ts,
 * shared/auth/service-auth.guard.ts, and
 * modules/tool-broker/infrastructure/http-core-api-client.ts. Wiring this
 * through `ConfigModule.forRoot({ validate })` (app.module.ts) turns a
 * missing secret into a bootstrap crash with a clear message instead of a
 * mid-call failure a real caller is waiting on. AI provider keys
 * (OPENAI_API_KEY etc.) are deliberately NOT required here — see
 * ai-provider.module.ts's own comment: an unconfigured vendor is simply
 * absent from the fallback chain, the same "optional integration" posture
 * as core-api's HOUSECALL_PRO_API_BASE_URL/TWILIO_AUTH_TOKEN.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3100),

  REDIS_URL: z.string().min(1, "REDIS_URL is required"),

  // HttpCoreApiClient's own env reads (modules/tool-broker/infrastructure/http-core-api-client.ts)
  // — every tool-broker call to core-api throws ToolHandlerError without these.
  CORE_API_BASE_URL: z.string().min(1, "CORE_API_BASE_URL is required"),
  CORE_API_SERVICE_API_KEY: z.string().min(1, "CORE_API_SERVICE_API_KEY is required"),

  // ServiceAuthGuard's shared secret (shared/auth/service-auth.guard.ts) —
  // every inbound request to this service is rejected without it, since
  // the guard is registered globally via APP_GUARD (app.module.ts).
  ORCHESTRATOR_SERVICE_TOKEN: z.string().min(1, "ORCHESTRATOR_SERVICE_TOKEN is required"),

  LOG_LEVEL: z.string().optional(),
  OTEL_SERVICE_NAME: z.string().optional(),
  OTEL_SDK_DISABLED: z.string().optional(),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),

  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_BASE_URL: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_BASE_URL: z.string().optional(),
  AI_PROVIDER_FALLBACK_ORDER: z.string().optional(),
  DEFAULT_LLM_MODEL: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

/**
 * The `validate` function `@nestjs/config`'s `ConfigModule.forRoot` calls
 * with the raw `process.env` — thrown errors here abort Nest's bootstrap
 * before any module is instantiated. Re-throwing zod's own formatted
 * message so a missing/malformed var is identifiable without a debugger.
 */
export function validate(config: Record<string, unknown>): Env {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    throw new Error(`Invalid environment configuration:\n${result.error.toString()}`);
  }
  return result.data;
}
