import { validate } from "./env.schema";

function validEnv(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    REDIS_URL: "redis://localhost:6379",
    CORE_API_BASE_URL: "http://localhost:3000/v1",
    CORE_API_SERVICE_API_KEY: "ethx_test_service_key",
    ORCHESTRATOR_SERVICE_TOKEN: "test-orchestrator-token",
    ...overrides,
  };
}

describe("voice-orchestrator env.schema validate()", () => {
  it("passes with every required var set and returns a parsed, typed config", () => {
    const result = validate(validEnv());

    expect(result.CORE_API_BASE_URL).toBe(validEnv()["CORE_API_BASE_URL"]);
    expect(result.NODE_ENV).toBe("development"); // default applied
    expect(result.PORT).toBe(3100); // default applied
  });

  it("throws when REDIS_URL is missing", () => {
    const env = validEnv();
    delete (env as Record<string, string | undefined>)["REDIS_URL"];

    expect(() => validate(env)).toThrow(/REDIS_URL/);
  });

  it("throws when CORE_API_BASE_URL is missing", () => {
    const env = validEnv();
    delete (env as Record<string, string | undefined>)["CORE_API_BASE_URL"];

    expect(() => validate(env)).toThrow(/CORE_API_BASE_URL/);
  });

  it("throws when CORE_API_SERVICE_API_KEY is missing", () => {
    const env = validEnv();
    delete (env as Record<string, string | undefined>)["CORE_API_SERVICE_API_KEY"];

    expect(() => validate(env)).toThrow(/CORE_API_SERVICE_API_KEY/);
  });

  it("throws when ORCHESTRATOR_SERVICE_TOKEN is missing", () => {
    const env = validEnv();
    delete (env as Record<string, string | undefined>)["ORCHESTRATOR_SERVICE_TOKEN"];

    expect(() => validate(env)).toThrow(/ORCHESTRATOR_SERVICE_TOKEN/);
  });

  it("passes without any AI provider key configured — each is optional, chosen at runtime by ai-provider.module.ts", () => {
    const env = validEnv();

    expect(() => validate(env)).not.toThrow();
  });

  it("accepts an AI provider key when present", () => {
    const env = validEnv({ OPENAI_API_KEY: "sk-test" });

    const result = validate(env);
    expect(result.OPENAI_API_KEY).toBe("sk-test");
  });
});
