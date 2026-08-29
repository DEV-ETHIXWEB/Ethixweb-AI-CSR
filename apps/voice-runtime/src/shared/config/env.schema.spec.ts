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
    // AI_RECEPTIONIST_ENABLED defaults to true (see below), which requires
    // EMERGENCY_TRANSFER_NUMBER (or HUMAN_FALLBACK_NUMBER) be set — a real
    // emergency mid-call must always have a real destination to transfer
    // to. Set here so every other test in this file, which isn't testing
    // that rule specifically, gets a valid baseline env by default.
    EMERGENCY_TRANSFER_NUMBER: "+15550009999",
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

  it("defaults AI_RECEPTIONIST_ENABLED to true (the kill switch is opt-in-to-disable, never opt-in-to-enable-by-accident)", () => {
    const result = validate(validEnv());

    expect(result.AI_RECEPTIONIST_ENABLED).toBe(true);
  });

  it("KILL SWITCH: throws at boot when AI_RECEPTIONIST_ENABLED=false but HUMAN_FALLBACK_NUMBER is not set — the kill switch must never activate without a real destination to forward to", () => {
    const env = validEnv({ AI_RECEPTIONIST_ENABLED: "false" });

    expect(() => validate(env)).toThrow(/HUMAN_FALLBACK_NUMBER is required/);
  });

  it("KILL SWITCH: passes when AI_RECEPTIONIST_ENABLED=false and HUMAN_FALLBACK_NUMBER is set", () => {
    const result = validate(
      validEnv({ AI_RECEPTIONIST_ENABLED: "false", HUMAN_FALLBACK_NUMBER: "+15550001234" }),
    );

    expect(result.AI_RECEPTIONIST_ENABLED).toBe(false);
    expect(result.HUMAN_FALLBACK_NUMBER).toBe("+15550001234");
  });

  it("EMERGENCY TRANSFER: throws at boot when AI_RECEPTIONIST_ENABLED=true (the default) but neither EMERGENCY_TRANSFER_NUMBER nor HUMAN_FALLBACK_NUMBER is set — a real emergency mid-call must always have a real destination to transfer to, not just a logged error", () => {
    const env = validEnv({ EMERGENCY_TRANSFER_NUMBER: "" });
    delete env["EMERGENCY_TRANSFER_NUMBER"];

    expect(() => validate(env)).toThrow(/EMERGENCY_TRANSFER_NUMBER .* is required/);
  });

  it("EMERGENCY TRANSFER: passes when AI_RECEPTIONIST_ENABLED=true and EMERGENCY_TRANSFER_NUMBER is set", () => {
    const result = validate(validEnv({ EMERGENCY_TRANSFER_NUMBER: "+15550009999" }));

    expect(result.EMERGENCY_TRANSFER_NUMBER).toBe("+15550009999");
  });

  it("EMERGENCY TRANSFER: passes when AI_RECEPTIONIST_ENABLED=true and only HUMAN_FALLBACK_NUMBER (no EMERGENCY_TRANSFER_NUMBER) is set — HUMAN_FALLBACK_NUMBER is the documented fallback destination", () => {
    const env = validEnv({ HUMAN_FALLBACK_NUMBER: "+15550001234" });
    delete env["EMERGENCY_TRANSFER_NUMBER"];

    const result = validate(env);

    expect(result.EMERGENCY_TRANSFER_NUMBER).toBeUndefined();
    expect(result.HUMAN_FALLBACK_NUMBER).toBe("+15550001234");
  });
});
