import { loadConfig } from "./config.js";

const REQUIRED_ENV = {
  ORCHESTRATOR_SERVICE_TOKEN: "token",
  DEEPGRAM_API_KEY: "dg-key",
  CARTESIA_API_KEY: "ct-key",
  CARTESIA_VOICE_ID: "voice-1",
  PILOT_TENANT_ID: "tenant-1",
  PILOT_BUSINESS_ID: "business-1",
  PILOT_ALLOWED_TOOLS: "searchCustomer,createLead",
};

describe("loadConfig", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("loads a complete config when every required var is set", () => {
    process.env = { ...process.env, ...REQUIRED_ENV };

    const config = loadConfig();

    expect(config.orchestratorServiceToken).toBe("token");
    expect(config.pilotAllowedTools).toEqual(["searchCustomer", "createLead"]);
    expect(config.deepgramModel).toBe("nova-3");
  });

  it("throws a clear error naming the missing var", () => {
    process.env = { ...originalEnv, ...REQUIRED_ENV };
    delete process.env["ORCHESTRATOR_SERVICE_TOKEN"];

    expect(() => loadConfig()).toThrow("ORCHESTRATOR_SERVICE_TOKEN is not configured");
  });
});
