import { PasswordHash, WeakPasswordError } from "./password-hash.vo";

describe("PasswordHash", () => {
  it("hashes a valid password and verifies the correct plaintext against it", async () => {
    const hash = await PasswordHash.hash("a-genuinely-long-password");
    expect(await hash.verify("a-genuinely-long-password")).toBe(true);
  });

  it("rejects the wrong plaintext on verify", async () => {
    const hash = await PasswordHash.hash("a-genuinely-long-password");
    expect(await hash.verify("totally-different-password")).toBe(false);
  });

  it("never stores the plaintext — toStoredValue() returns a bcrypt hash, not the input", async () => {
    const plaintext = "a-genuinely-long-password";
    const hash = await PasswordHash.hash(plaintext);
    expect(hash.toStoredValue()).not.toContain(plaintext);
    expect(hash.toStoredValue()).toMatch(/^\$2[aby]\$/);
  });

  it("rejects a password shorter than the 12-character policy minimum", async () => {
    await expect(PasswordHash.hash("short1234567".slice(0, 8))).rejects.toThrow(WeakPasswordError);
  });

  it("fromStoredHash + verify round-trips correctly against a previously-hashed value", async () => {
    const original = await PasswordHash.hash("a-genuinely-long-password");
    const reloaded = PasswordHash.fromStoredHash(original.toStoredValue());
    expect(await reloaded.verify("a-genuinely-long-password")).toBe(true);
  });

  it("timingSafeDummy() produces a valid-format hash that never matches any real password", async () => {
    const dummy = PasswordHash.timingSafeDummy();
    expect(await dummy.verify("literally anything")).toBe(false);
    expect(await dummy.verify("a-genuinely-long-password")).toBe(false);
  });
});
