import { Injectable } from "@nestjs/common";
import { RedisService } from "../../../shared/redis/redis.service";
import type { RefreshTokenStore } from "../domain/ports/refresh-token-store.port";

const TOKEN_KEY_PREFIX = "auth:refresh:";
const USER_INDEX_PREFIX = "auth:refresh:by-user:";

// GET-then-DEL as two separate round-trips has the same class of race as
// the rate limiter's INCR-then-EXPIRE (see redis-rate-limiter.ts): two
// concurrent callers can both observe the token as valid before either
// deletes it. A Lua script makes the check-and-invalidate a single atomic
// Redis operation, so at most one caller ever gets `1` back.
const CONSUME_SCRIPT = `
local storedUserId = redis.call("GET", KEYS[1])
if storedUserId == ARGV[1] then
  redis.call("DEL", KEYS[1])
  redis.call("SREM", KEYS[2], ARGV[2])
  return 1
else
  return 0
end
`;

@Injectable()
export class RedisRefreshTokenStore implements RefreshTokenStore {
  constructor(private readonly redis: RedisService) {}

  async store(userId: string, jti: string, ttlSeconds: number): Promise<void> {
    await this.redis
      .multi()
      .set(this.tokenKey(jti), userId, "EX", ttlSeconds)
      .sadd(this.userIndexKey(userId), jti)
      .exec();
  }

  async isValid(userId: string, jti: string): Promise<boolean> {
    const storedUserId = await this.redis.get(this.tokenKey(jti));
    return storedUserId === userId;
  }

  async consume(userId: string, jti: string): Promise<boolean> {
    const result = (await this.redis.eval(
      CONSUME_SCRIPT,
      2,
      this.tokenKey(jti),
      this.userIndexKey(userId),
      userId,
      jti,
    )) as number;
    return result === 1;
  }

  async revoke(userId: string, jti: string): Promise<void> {
    await this.redis.multi().del(this.tokenKey(jti)).srem(this.userIndexKey(userId), jti).exec();
  }

  async revokeAll(userId: string): Promise<void> {
    const jtis = await this.redis.smembers(this.userIndexKey(userId));
    if (jtis.length === 0) {
      return;
    }
    const pipeline = this.redis.multi();
    for (const jti of jtis) {
      pipeline.del(this.tokenKey(jti));
    }
    pipeline.del(this.userIndexKey(userId));
    await pipeline.exec();
  }

  private tokenKey(jti: string): string {
    return `${TOKEN_KEY_PREFIX}${jti}`;
  }

  private userIndexKey(userId: string): string {
    return `${USER_INDEX_PREFIX}${userId}`;
  }
}
