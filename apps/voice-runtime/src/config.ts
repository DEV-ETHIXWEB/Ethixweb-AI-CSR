/**
 * Phase 1 is a single-tenant pilot (docs/01 §9) — there is no DID->tenant
 * lookup service yet, matching HttpCoreApiClient's own documented precedent
 * (apps/voice-orchestrator/src/modules/tool-broker/infrastructure/http-core-api-client.ts:
 * a single static CORE_API_SERVICE_API_KEY, not per-tenant credentials, for
 * the identical stated reason). Real per-DID tenant resolution is future
 * multi-tenant work, not invented speculatively here.
 */
export interface RuntimeConfig {
  port: number;
  orchestratorBaseUrl: string;
  orchestratorServiceToken: string;
  deepgramApiKey: string;
  deepgramModel: string;
  cartesiaApiKey: string;
  cartesiaModel: string;
  cartesiaVoice: string;
  pilotTenantId: string;
  pilotBusinessId: string;
  pilotTimezone: string;
  pilotAllowedTools: string[];
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not configured — see apps/voice-runtime/.env.example`);
  }
  return value;
}

export function loadConfig(): RuntimeConfig {
  return {
    port: Number(process.env["PORT"] ?? 3200),
    orchestratorBaseUrl: process.env["ORCHESTRATOR_BASE_URL"] ?? "http://localhost:3100/v1",
    orchestratorServiceToken: requireEnv("ORCHESTRATOR_SERVICE_TOKEN"),
    deepgramApiKey: requireEnv("DEEPGRAM_API_KEY"),
    deepgramModel: process.env["DEEPGRAM_MODEL"] ?? "nova-3",
    cartesiaApiKey: requireEnv("CARTESIA_API_KEY"),
    cartesiaModel: process.env["CARTESIA_MODEL"] ?? "sonic-3",
    cartesiaVoice: requireEnv("CARTESIA_VOICE_ID"),
    pilotTenantId: requireEnv("PILOT_TENANT_ID"),
    pilotBusinessId: requireEnv("PILOT_BUSINESS_ID"),
    pilotTimezone: process.env["PILOT_TIMEZONE"] ?? "America/Chicago",
    pilotAllowedTools: requireEnv("PILOT_ALLOWED_TOOLS")
      .split(",")
      .map((tool) => tool.trim())
      .filter((tool) => tool.length > 0),
  };
}
