import { validate } from "./env.schema";

function validEnv(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    DATABASE_URL: "postgresql://app_runtime:pw@localhost:5432/ethixweb_csr",
    REDIS_URL: "redis://localhost:6379",
    JWT_ACCESS_SECRET: "access-secret",
    JWT_REFRESH_SECRET: "refresh-secret",
    INTEGRATION_CREDENTIALS_MASTER_KEY: "a".repeat(64),
    ...overrides,
  };
}

describe("core-api env.schema validate()", () => {
  it("passes with every required var set and returns a parsed, typed config", () => {
    const result = validate(validEnv());

    expect(result.DATABASE_URL).toBe(validEnv()["DATABASE_URL"]);
    expect(result.NODE_ENV).toBe("development"); // default applied
    expect(result.PORT).toBe(3000); // default applied
  });

  it("throws when DATABASE_URL is missing", () => {
    const env = validEnv();
    delete (env as Record<string, string | undefined>)["DATABASE_URL"];

    expect(() => validate(env)).toThrow(/DATABASE_URL/);
  });

  it("throws when JWT_ACCESS_SECRET is missing", () => {
    const env = validEnv();
    delete (env as Record<string, string | undefined>)["JWT_ACCESS_SECRET"];

    expect(() => validate(env)).toThrow(/JWT_ACCESS_SECRET/);
  });

  it("throws when REDIS_URL is missing", () => {
    const env = validEnv();
    delete (env as Record<string, string | undefined>)["REDIS_URL"];

    expect(() => validate(env)).toThrow(/REDIS_URL/);
  });

  it("throws when INTEGRATION_CREDENTIALS_MASTER_KEY is the wrong length", () => {
    const env = validEnv({ INTEGRATION_CREDENTIALS_MASTER_KEY: "a".repeat(32) });

    expect(() => validate(env)).toThrow(/INTEGRATION_CREDENTIALS_MASTER_KEY/);
  });

  it("throws when INTEGRATION_CREDENTIALS_MASTER_KEY is not valid hex", () => {
    const env = validEnv({ INTEGRATION_CREDENTIALS_MASTER_KEY: "z".repeat(64) });

    expect(() => validate(env)).toThrow(/INTEGRATION_CREDENTIALS_MASTER_KEY/);
  });

  it("passes without TWILIO_AUTH_TOKEN — optional, matching HOUSECALL_PRO_API_BASE_URL's precedent", () => {
    const env = validEnv();

    expect(() => validate(env)).not.toThrow();
  });

  it("passes with TWILIO_AUTH_TOKEN set", () => {
    const env = validEnv({ TWILIO_AUTH_TOKEN: "test-token" });

    const result = validate(env);
    expect(result.TWILIO_AUTH_TOKEN).toBe("test-token");
  });
});
