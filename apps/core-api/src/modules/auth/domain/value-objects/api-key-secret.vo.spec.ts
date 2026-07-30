import { ApiKeySecret } from "./api-key-secret.vo";

describe("ApiKeySecret", () => {
  it("generates a plaintext key with the expected prefix and a matching hash", () => {
    const secret = ApiKeySecret.generate();
    expect(secret.plaintext).toMatch(/^ethx_[0-9a-f]{64}$/);
    expect(secret.hash).toBe(ApiKeySecret.hashOf(secret.plaintext));
  });

  it("generates a different plaintext/hash on every call", () => {
    const a = ApiKeySecret.generate();
    const b = ApiKeySecret.generate();
    expect(a.plaintext).not.toBe(b.plaintext);
    expect(a.hash).not.toBe(b.hash);
  });

  it("hashOf is deterministic for the same input", () => {
    const plaintext = "ethx_deadbeef";
    expect(ApiKeySecret.hashOf(plaintext)).toBe(ApiKeySecret.hashOf(plaintext));
  });

  it("hashOf produces different output for different input", () => {
    expect(ApiKeySecret.hashOf("ethx_aaaa")).not.toBe(ApiKeySecret.hashOf("ethx_bbbb"));
  });
});
