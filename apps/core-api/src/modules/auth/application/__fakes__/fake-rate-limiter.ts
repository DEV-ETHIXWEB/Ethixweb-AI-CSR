import type { RateLimiter, RateLimitResult } from "../../domain/ports/rate-limiter.port";

/** Always allows, by default — tests that need to exercise the limited path construct one with a low limit directly, or call consume() enough times themselves. */
export class FakeRateLimiter implements RateLimiter {
  private readonly counts = new Map<string, number>();

  async consume(
    key: string,
    maxAttempts: number,
    _windowSeconds: number,
  ): Promise<RateLimitResult> {
    const current = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, current);
    if (current > maxAttempts) {
      return { allowed: false, retryAfterSeconds: 900 };
    }
    return { allowed: true };
  }
}
