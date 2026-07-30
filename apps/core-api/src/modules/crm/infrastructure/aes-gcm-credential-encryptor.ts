import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type { CredentialEncryptor } from "../domain/ports/credential-encryptor.port";
import type { CrmCredential } from "../domain/crm-credential";

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH_BYTES = 32; // 256-bit
const IV_LENGTH_BYTES = 12; // 96-bit, the standard/recommended GCM nonce size
const AUTH_TAG_LENGTH_BYTES = 16;
const HKDF_INFO = "ethixweb-integration-credentials-v1";

/**
 * Local stand-in for the AWS KMS envelope encryption docs/08-security-observability-reliability.md
 * §1.2 specifies — see credential-encryptor.port.ts's own comment for why.
 * Still a genuine per-tenant-key design, not a single shared key encrypting
 * every tenant's credentials: HKDF derives a distinct 256-bit key per
 * tenant from one master key + that tenant's id as salt, so this class
 * never has to store or manage per-tenant keys itself, and compromising one
 * derived key doesn't expose another tenant's plaintext (HKDF is one-way —
 * the master key can't be recovered from a derived key, and one tenant's
 * derived key reveals nothing about another tenant's).
 */
@Injectable()
export class AesGcmCredentialEncryptor implements CredentialEncryptor {
  private readonly masterKey: Buffer;

  constructor() {
    const hex = process.env["INTEGRATION_CREDENTIALS_MASTER_KEY"];
    if (!hex) {
      throw new Error("INTEGRATION_CREDENTIALS_MASTER_KEY is not set.");
    }
    const key = Buffer.from(hex, "hex");
    if (key.length !== KEY_LENGTH_BYTES) {
      throw new Error(
        `INTEGRATION_CREDENTIALS_MASTER_KEY must be a ${KEY_LENGTH_BYTES}-byte (${KEY_LENGTH_BYTES * 2}-hex-char) key, got ${key.length} bytes.`,
      );
    }
    this.masterKey = key;
  }

  async encrypt(tenantId: string, credential: CrmCredential): Promise<Buffer> {
    const dek = this.deriveTenantKey(tenantId);
    const iv = randomBytes(IV_LENGTH_BYTES);
    const cipher = createCipheriv(ALGORITHM, dek, iv, {
      authTagLength: AUTH_TAG_LENGTH_BYTES,
    });
    const plaintext = Buffer.from(JSON.stringify(credential), "utf8");
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();
    // Layout: [iv | authTag | ciphertext] — fixed-length iv/authTag prefixes
    // make this self-describing without a separate metadata column.
    return Buffer.concat([iv, authTag, ciphertext]);
  }

  async decrypt(tenantId: string, ciphertext: Buffer): Promise<CrmCredential> {
    const dek = this.deriveTenantKey(tenantId);
    const iv = ciphertext.subarray(0, IV_LENGTH_BYTES);
    const authTag = ciphertext.subarray(IV_LENGTH_BYTES, IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES);
    const encrypted = ciphertext.subarray(IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES);
    const decipher = createDecipheriv(ALGORITHM, dek, iv, {
      authTagLength: AUTH_TAG_LENGTH_BYTES,
    });
    decipher.setAuthTag(authTag);
    // GCM's auth tag check makes tampering (or decrypting with the wrong
    // tenant's derived key) throw here rather than silently returning
    // garbage bytes — a corrupted/foreign ciphertext fails loudly.
    const plaintext = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return JSON.parse(plaintext.toString("utf8")) as CrmCredential;
  }

  private deriveTenantKey(tenantId: string): Buffer {
    return Buffer.from(hkdfSync("sha256", this.masterKey, tenantId, HKDF_INFO, KEY_LENGTH_BYTES));
  }
}
