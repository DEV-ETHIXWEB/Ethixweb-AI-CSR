import { z } from "zod";

const HEX_32_BYTE = /^[0-9a-f]{64}$/i;

/**
 * Fail at boot, not mid-request: every one of these vars already has a
 * runtime `process.env["X"]` read somewhere in this app (PrismaService,
 * RedisService, jwt-token.service.ts, aes-gcm-credential-encryptor.ts) that
 * throws — or, worse, silently misbehaves — the first time a request
 * actually exercises that code path. Wiring this through `ConfigModule.forRoot({
 * validate })` (app.module.ts) means a missing/malformed secret is a
 * bootstrap crash with a clear message instead of a 500 an hour into
 * production traffic. Optional integrations (commented out in
 * .env.example — HOUSECALL_PRO_API_BASE_URL, TWILIO_AUTH_TOKEN) are
 * deliberately NOT required here, matching that same precedent: the app
 * boots with those features disabled/failing-closed at the call site
 * (see TwilioSignatureGuard) rather than refusing to start over an
 * integration a given deployment may not use yet.
 *
 * `INTEGRATION_CREDENTIALS_MASTER_KEY` is validated for exact byte length
 * here (not just "is a string") because AesGcmCredentialEncryptor's own
 * constructor already throws on anything else — catching the same failure
 * at boot instead of the first CRM-credential read is the entire point of
 * this file.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  // MIGRATION_DATABASE_URL is used only by `prisma migrate`/`generate`
  // (packages/database/prisma.config.ts), never by the running app — not
  // validated here, since requiring it would make the app refuse to boot
  // in any environment where migrations are run by a separate CI step
  // with its own credentials.
  REDIS_URL: z.string().min(1, "REDIS_URL is required"),

  JWT_ACCESS_SECRET: z.string().min(1, "JWT_ACCESS_SECRET is required"),
  JWT_REFRESH_SECRET: z.string().min(1, "JWT_REFRESH_SECRET is required"),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().optional(),
  JWT_REFRESH_TTL_SECONDS: z.coerce.number().int().positive().optional(),

  INTEGRATION_CREDENTIALS_MASTER_KEY: z
    .string()
    .regex(HEX_32_BYTE, "INTEGRATION_CREDENTIALS_MASTER_KEY must be a 32-byte (64 hex char) key"),

  LOG_LEVEL: z.string().optional(),
  OTEL_SERVICE_NAME: z.string().optional(),
  OTEL_SDK_DISABLED: z.string().optional(),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),

  // Optional: SMS claim-reply (TwilioSignatureGuard) fails closed with 403
  // per-request if this is unset, rather than the app refusing to boot —
  // see this file's own top comment and .env.example's TWILIO_AUTH_TOKEN entry.
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_FROM_NUMBER: z.string().optional(),

  // Optional — housecall-pro.adapter.ts falls back to a hardcoded default
  // when unset; see .env.example's own comment on why it's commented out.
  HOUSECALL_PRO_API_BASE_URL: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

/**
 * The `validate` function `@nestjs/config`'s `ConfigModule.forRoot` calls
 * with the raw `process.env` — thrown errors here abort Nest's bootstrap
 * before any module (and therefore any of this app's controllers/use
 * cases) is instantiated. Re-throwing zod's own formatted message rather
 * than a generic "invalid config" — the point is a developer or deployment
 * pipeline can read exactly which var is missing/malformed without
 * attaching a debugger.
 */
export function validate(config: Record<string, unknown>): Env {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    throw new Error(`Invalid environment configuration:\n${result.error.toString()}`);
  }
  return result.data;
}
