/** docs/06-database-schema.md API_KEYS, docs/08-security-observability-reliability.md §1.1. */
export interface ApiKey {
  id: string;
  tenantId: string;
  /** SHA-256 hash of the key — the plaintext key is shown to the caller exactly once, at creation, and never stored. */
  keyHash: string;
  scopes: string;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

export function isApiKeyActive(apiKey: ApiKey, now: Date = new Date()): boolean {
  if (apiKey.revokedAt !== null) {
    return false;
  }
  if (apiKey.expiresAt !== null && apiKey.expiresAt <= now) {
    return false;
  }
  return true;
}
