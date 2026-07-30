/**
 * The Redis-backed revocation list docs/13-implementation-backlog.md's
 * `auth` module §1 calls for. An allowlist, not a denylist: presence of a
 * `jti` means the refresh token is still valid; absence (never issued,
 * already rotated, explicitly revoked, or past its TTL) means it isn't.
 * This makes "is this token still good" and "immediate compromise
 * response" the same single lookup, rather than needing to distinguish
 * "not in the denylist" from "never existed."
 */
export interface RefreshTokenStore {
  /** Records a newly-issued refresh token's jti as valid until `ttlSeconds` elapses or it's explicitly revoked. */
  store(userId: string, jti: string, ttlSeconds: number): Promise<void>;
  /** True only if this exact jti is currently valid for this exact user. */
  isValid(userId: string, jti: string): Promise<boolean>;
  /**
   * Atomically checks-and-invalidates a refresh token in one operation,
   * returning whether it was valid. Rotation MUST use this, not a separate
   * `isValid()` + `revoke()` pair — those are two round-trips with a real
   * TOCTOU gap between them, found during a security review: two concurrent
   * uses of the same refresh token (a replayed/stolen token racing the
   * legitimate client, or even just a client's own retry-on-timeout) could
   * both observe `isValid() === true` before either revoked it, so BOTH
   * would be issued a fresh token pair from a single original one — exactly
   * the failure this store's rotation model exists to prevent. `consume()`
   * closes that gap by making the check and the invalidation a single
   * atomic step (see RedisRefreshTokenStore's Lua-script implementation).
   */
  consume(userId: string, jti: string): Promise<boolean>;
  /** Invalidates one refresh token — used for single-session logout (rotation uses `consume()` instead, see its own comment on why). */
  revoke(userId: string, jti: string): Promise<void>;
  /** Invalidates every refresh token currently issued to a user — logout-everywhere / compromise response. */
  revokeAll(userId: string): Promise<void>;
}

export const REFRESH_TOKEN_STORE = Symbol("REFRESH_TOKEN_STORE");
