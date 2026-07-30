import { createHash, randomBytes } from "node:crypto";

const API_KEY_BYTE_LENGTH = 32; // 256 bits of entropy
const API_KEY_PREFIX = "ethx_";

/**
 * A high-entropy random secret (unlike a human-chosen password) — SHA-256
 * is the correct, standard choice here, not bcrypt/argon2. Those algorithms
 * are deliberately slow to defend a *low-entropy* secret against brute
 * force; a 256-bit random key has no brute-force surface for a fast hash
 * to expose, and hashing every API request through a deliberately-slow
 * KDF would be a real, needless latency cost. Verification is a database
 * equality match on the hash (see ADR-015's `lookup_api_key_for_auth`),
 * not an application-layer string comparison, so no timing-safe-compare
 * helper is needed here either.
 */
export class ApiKeySecret {
  private constructor(
    public readonly plaintext: string,
    public readonly hash: string,
  ) {}

  /** The plaintext is shown to the caller exactly once, here, and never stored. */
  static generate(): ApiKeySecret {
    const plaintext = `${API_KEY_PREFIX}${randomBytes(API_KEY_BYTE_LENGTH).toString("hex")}`;
    return new ApiKeySecret(plaintext, ApiKeySecret.hashOf(plaintext));
  }

  static hashOf(plaintext: string): string {
    return createHash("sha256").update(plaintext).digest("hex");
  }
}
