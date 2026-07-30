import { Injectable } from "@nestjs/common";
import { RedisService } from "../../../shared/redis/redis.service";
import type { RateLimiter, RateLimitResult } from "../domain/ports/rate-limiter.port";

const KEY_PREFIX = "ratelimit:";

// INCR-then-conditionally-EXPIRE as two separate round-trips has a real,
// narrow race: if the process crashes between them, the key survives with
// no TTL and never resets. A Lua script executes atomically in Redis (the
// whole script runs as one operation, no other command can interleave),
// closing that gap entirely rather than accepting the risk — worth the
// small extra complexity for something explicitly named in a security
// review ("brute-force protection").
const INCREMENT_WITH_EXPIRY_SCRIPT = `
local current = redis.call("INCR", KEYS[1])
if current == 1 then
  redis.call("EXPIRE", KEYS[1], ARGV[1])
end
return current
`;

@Injectable()
export class RedisRateLimiter implements RateLimiter {
  constructor(private readonly redis: RedisService) {}

  async consume(key: string, maxAttempts: number, windowSeconds: number): Promise<RateLimitResult> {
    const redisKey = `${KEY_PREFIX}${key}`;
    const count = (await this.redis.eval(
      INCREMENT_WITH_EXPIRY_SCRIPT,
      1,
      redisKey,
      windowSeconds,
    )) as number;

    if (count > maxAttempts) {
      const ttl = await this.redis.ttl(redisKey);
      return { allowed: false, retryAfterSeconds: Math.max(ttl, 1) };
    }
    return { allowed: true };
  }
}
