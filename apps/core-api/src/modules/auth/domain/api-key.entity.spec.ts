import { isApiKeyActive, type ApiKey } from "./api-key.entity";

function baseApiKey(overrides: Partial<ApiKey> = {}): ApiKey {
  return {
    id: "key-1",
    tenantId: "tenant-1",
    keyHash: "hash",
    scopes: "full",
    expiresAt: null,
    revokedAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("isApiKeyActive", () => {
  it("is active when never revoked and never expires", () => {
    expect(isApiKeyActive(baseApiKey())).toBe(true);
  });

  it("is inactive once revoked, regardless of expiry", () => {
    const apiKey = baseApiKey({ revokedAt: new Date("2026-01-02T00:00:00Z") });
    expect(isApiKeyActive(apiKey)).toBe(false);
  });

  it("is active before its expiry timestamp", () => {
    const apiKey = baseApiKey({ expiresAt: new Date("2030-01-01T00:00:00Z") });
    expect(isApiKeyActive(apiKey, new Date("2026-06-01T00:00:00Z"))).toBe(true);
  });

  it("is inactive at or after its expiry timestamp", () => {
    const apiKey = baseApiKey({ expiresAt: new Date("2026-01-01T00:00:00Z") });
    expect(isApiKeyActive(apiKey, new Date("2026-01-01T00:00:00Z"))).toBe(false);
    expect(isApiKeyActive(apiKey, new Date("2026-06-01T00:00:00Z"))).toBe(false);
  });
});
