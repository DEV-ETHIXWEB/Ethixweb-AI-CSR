import { validate } from "./env.schema";

function validEnv(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    PUBLIC_BASE_URL: "https://runtime.ngrok.example.com",
    VOICE_ORCHESTRATOR_BASE_URL: "http://localhost:3100",
    ORCHESTRATOR_SERVICE_TOKEN: "test-orchestrator-token",
    TWILIO_ACCOUNT_SID: "ACtest",
    TWILIO_AUTH_TOKEN: "twilio-auth-token",
    TWILIO_PHONE_NUMBER: "+15551234567",
    DEEPGRAM_API_KEY: "deepgram-key",
    ELEVENLABS_API_KEY: "elevenlabs-key",
    ELEVENLABS_VOICE_ID: "voice-1",
    ...overrides,
  };
}

describe("voice-runtime env.schema validate()", () => {
  it("passes with every required var set and returns a parsed, typed config", () => {
    const result = validate(validEnv());

    expect(result.VOICE_ORCHESTRATOR_BASE_URL).toBe("http://localhost:3100");
    expect(result.NODE_ENV).toBe("development"); // default applied
    expect(result.PORT).toBe(3200); // default applied
    expect(result.TWILIO_SIGNATURE_VALIDATION_DISABLED).toBe(false); // default applied, coerced to boolean
  });

  for (const requiredVar of [
    "PUBLIC_BASE_URL",
    "VOICE_ORCHESTRATOR_BASE_URL",
    "ORCHESTRATOR_SERVICE_TOKEN",
    "TWILIO_ACCOUNT_SID",
    "TWILIO_AUTH_TOKEN",
    "TWILIO_PHONE_NUMBER",
    "DEEPGRAM_API_KEY",
    "ELEVENLABS_API_KEY",
    "ELEVENLABS_VOICE_ID",
  ]) {
    it(`throws when ${requiredVar} is missing`, () => {
      const env = validEnv();
      delete (env as Record<string, string | undefined>)[requiredVar];

      expect(() => validate(env)).toThrow(new RegExp(requiredVar));
    });
  }

  it("coerces TWILIO_SIGNATURE_VALIDATION_DISABLED='true' to boolean true", () => {
    const result = validate(validEnv({ TWILIO_SIGNATURE_VALIDATION_DISABLED: "true" }));

    expect(result.TWILIO_SIGNATURE_VALIDATION_DISABLED).toBe(true);
  });

  it("rejects a TWILIO_SIGNATURE_VALIDATION_DISABLED value other than 'true'/'false'", () => {
    const env = validEnv({ TWILIO_SIGNATURE_VALIDATION_DISABLED: "yes" });

    expect(() => validate(env)).toThrow();
  });

  it("passes without TENANT_ROUTING_MAP or TENANT_ROUTING_DEFAULT_* configured — both are optional at the schema level (StaticTenantRoutingProvider owns the actual required-at-call-time check)", () => {
    expect(() => validate(validEnv())).not.toThrow();
  });
});
