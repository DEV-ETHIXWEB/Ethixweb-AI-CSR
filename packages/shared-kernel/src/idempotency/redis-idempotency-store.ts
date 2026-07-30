import type { Redis } from "ioredis";
import type {
  IdempotencyBeginOptions,
  IdempotencyOutcome,
  IdempotencyStore,
} from "./idempotency-store";

const IN_FLIGHT_MARKER = "__IN_FLIGHT__";
const DEFAULT_TTL_SECONDS = 86_400;
const DEFAULT_KEY_PREFIX = "idempotency:";

/** Production-backing implementation of {@link IdempotencyStore}, using Redis `SET NX` for atomic reservation. */
export class RedisIdempotencyStore implements IdempotencyStore {
  constructor(
    private readonly redis: Redis,
    private readonly keyPrefix: string = DEFAULT_KEY_PREFIX,
  ) {}

  async begin<T = unknown>(
    key: string,
    options: IdempotencyBeginOptions = {},
  ): Promise<IdempotencyOutcome<T>> {
    const ttlSeconds = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;
    const namespacedKey = this.namespacedKey(key);

    const reserved = await this.redis.set(namespacedKey, IN_FLIGHT_MARKER, "EX", ttlSeconds, "NX");
    if (reserved === "OK") {
      return { status: "proceed" };
    }

    const existing = await this.redis.get(namespacedKey);
    if (existing === null || existing === IN_FLIGHT_MARKER) {
      return { status: "in_flight" };
    }
    return { status: "completed", result: JSON.parse(existing) as T };
  }

  async complete(
    key: string,
    result: unknown,
    options: IdempotencyBeginOptions = {},
  ): Promise<void> {
    const ttlSeconds = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;
    await this.redis.set(this.namespacedKey(key), JSON.stringify(result), "EX", ttlSeconds);
  }

  async release(key: string): Promise<void> {
    const namespacedKey = this.namespacedKey(key);
    const current = await this.redis.get(namespacedKey);
    if (current === IN_FLIGHT_MARKER) {
      await this.redis.del(namespacedKey);
    }
  }

  private namespacedKey(key: string): string {
    return `${this.keyPrefix}${key}`;
  }
}
