import { randomBytes } from "node:crypto";
import { AesGcmCredentialEncryptor } from "./aes-gcm-credential-encryptor";

const ORIGINAL_ENV = { ...process.env };

function setKey(hex: string | undefined): void {
  if (hex === undefined) {
    delete process.env["INTEGRATION_CREDENTIALS_MASTER_KEY"];
  } else {
    process.env["INTEGRATION_CREDENTIALS_MASTER_KEY"] = hex;
  }
}

describe("AesGcmCredentialEncryptor", () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("throws at construction time if the master key is missing", () => {
    setKey(undefined);
    expect(() => new AesGcmCredentialEncryptor()).toThrow(
      "INTEGRATION_CREDENTIALS_MASTER_KEY is not set.",
    );
  });

  it("throws at construction time if the master key is the wrong length", () => {
    setKey("aabbcc"); // way short of 32 bytes
    expect(() => new AesGcmCredentialEncryptor()).toThrow(/32-byte/);
  });

  it("round-trips a credential through encrypt/decrypt", async () => {
    setKey(randomBytes(32).toString("hex"));
    const encryptor = new AesGcmCredentialEncryptor();
    const credential = { type: "api_key" as const, apiKey: "super-secret-key" };

    const ciphertext = await encryptor.encrypt("tenant-1", credential);
    const decrypted = await encryptor.decrypt("tenant-1", ciphertext);

    expect(decrypted).toEqual(credential);
  });

  it("never stores the plaintext secret anywhere in the ciphertext bytes", async () => {
    setKey(randomBytes(32).toString("hex"));
    const encryptor = new AesGcmCredentialEncryptor();
    const credential = { type: "api_key" as const, apiKey: "super-secret-key-marker" };

    const ciphertext = await encryptor.encrypt("tenant-1", credential);

    expect(ciphertext.toString("utf8")).not.toContain("super-secret-key-marker");
    expect(ciphertext.toString("hex")).not.toContain(
      Buffer.from("super-secret-key-marker").toString("hex"),
    );
  });

  it("fails to decrypt with a DIFFERENT tenant's derived key (per-tenant isolation)", async () => {
    setKey(randomBytes(32).toString("hex"));
    const encryptor = new AesGcmCredentialEncryptor();
    const credential = { type: "api_key" as const, apiKey: "tenant-a-secret" };

    const ciphertext = await encryptor.encrypt("tenant-a", credential);

    await expect(encryptor.decrypt("tenant-b", ciphertext)).rejects.toThrow();
  });

  it("fails to decrypt tampered ciphertext (GCM auth tag catches it)", async () => {
    setKey(randomBytes(32).toString("hex"));
    const encryptor = new AesGcmCredentialEncryptor();
    const ciphertext = await encryptor.encrypt("tenant-1", {
      type: "api_key",
      apiKey: "original-secret",
    });

    const tampered = Buffer.from(ciphertext);
    tampered[tampered.length - 1] = (tampered[tampered.length - 1]! + 1) % 256;

    await expect(encryptor.decrypt("tenant-1", tampered)).rejects.toThrow();
  });

  it("produces different ciphertext for the same credential across two calls (random IV, no nonce reuse)", async () => {
    setKey(randomBytes(32).toString("hex"));
    const encryptor = new AesGcmCredentialEncryptor();
    const credential = { type: "api_key" as const, apiKey: "same-secret" };

    const first = await encryptor.encrypt("tenant-1", credential);
    const second = await encryptor.encrypt("tenant-1", credential);

    expect(first.equals(second)).toBe(false);
  });
});
