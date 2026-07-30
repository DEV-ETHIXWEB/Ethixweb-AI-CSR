export type RateLimitResult = { allowed: true } | { allowed: false; retryAfterSeconds: number };

/**
 * Brute-force protection for login (docs' security-review checklist —
 * nothing in the original backlog named this explicitly, but "JWT
 * issuance," RBAC, and API-key handling all assume the credential-checking
 * endpoint in front of them isn't guessable by unlimited retries). Generic
 * fixed-window limiter, not login-specific, so other modules can reuse it
 * (e.g. a future rate limit on webhook signature verification failures).
 */
export interface RateLimiter {
  /**
   * Consumes one attempt against `key`. Returns `{allowed: true}` and
   * increments the counter if under `maxAttempts` within `windowSeconds`;
   * otherwise `{allowed: false, retryAfterSeconds}` without granting the
   * attempt.
   */
  consume(key: string, maxAttempts: number, windowSeconds: number): Promise<RateLimitResult>;
}

export const RATE_LIMITER = Symbol("RATE_LIMITER");
