import RedisMock from "ioredis-mock";
import type { RedisService } from "../../../shared/redis/redis.service";
import { RedisRateLimiter } from "./redis-rate-limiter";

async function createLimiter(): Promise<RedisRateLimiter> {
  const redis = new RedisMock();
  await redis.flushall();
  return new RedisRateLimiter(redis as unknown as RedisService);
}

describe("RedisRateLimiter", () => {
  it("allows attempts under the limit", async () => {
    const limiter = await createLimiter();
    for (let i = 0; i < 5; i++) {
      const result = await limiter.consume("key-1", 5, 60);
      expect(result.allowed).toBe(true);
    }
  });

  it("rejects the attempt that exceeds the limit, with a positive retryAfterSeconds", async () => {
    const limiter = await createLimiter();
    for (let i = 0; i < 5; i++) {
      await limiter.consume("key-1", 5, 60);
    }

    const result = await limiter.consume("key-1", 5, 60);

    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.retryAfterSeconds).toBeGreaterThan(0);
    }
  });

  it("tracks different keys independently", async () => {
    const limiter = await createLimiter();
    for (let i = 0; i < 5; i++) {
      await limiter.consume("key-a", 5, 60);
    }

    const keyAResult = await limiter.consume("key-a", 5, 60);
    const keyBResult = await limiter.consume("key-b", 5, 60);

    expect(keyAResult.allowed).toBe(false);
    expect(keyBResult.allowed).toBe(true);
  });

  it("sets a TTL on first use so the window actually expires", async () => {
    const redis = new RedisMock();
    await redis.flushall();
    const limiter = new RedisRateLimiter(redis as unknown as RedisService);

    await limiter.consume("key-1", 5, 60);

    const ttl = await redis.ttl("ratelimit:key-1");
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60);
  });
});
