import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import Redis from "ioredis";

/**
 * Thin lifecycle wrapper around the ioredis client — the same relationship
 * PrismaService has to PrismaClient. Backs the JWT refresh-token revocation
 * list (docs/08-security-observability-reliability.md §1.1) and, later,
 * @ethixweb/shared-kernel's RedisIdempotencyStore and BullMQ queues.
 */
@Injectable()
export class RedisService extends Redis implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);

  constructor() {
    const url = process.env["REDIS_URL"];
    if (!url) {
      throw new Error("REDIS_URL is not set.");
    }
    super(url, {
      lazyConnect: true,
      // ioredis's own defaults (maxRetriesPerRequest: 20, no
      // commandTimeout) mean a single command issued while Redis is
      // unreachable doesn't reject until 20 reconnect attempts have been
      // exhausted — reproduced live: with Redis stopped, POST /v1/auth/login
      // (rate limiter + refresh-token store, both Redis-backed) hung for
      // 30+ seconds with no response at all, rather than failing fast with
      // a clean 5xx. Bounded here so ANY command against an unreachable
      // Redis fails within ~3s instead of tens of seconds — the
      // request-path code (RedisRateLimiter, RedisRefreshTokenStore, etc.)
      // already either propagates or is meant to propagate that failure as
      // a real error response, it just never got the chance to before this
      // fix. Does not affect the live-call path (X-Api-Key-authenticated
      // tool-broker endpoints) at all — that path was already unaffected
      // by a Redis outage, confirmed live before this change.
      maxRetriesPerRequest: 3,
      commandTimeout: 3000,
    });
  }

  async onModuleInit(): Promise<void> {
    await this.connect();
    this.logger.log("Connected to Redis");
  }

  onModuleDestroy(): void {
    this.disconnect();
  }
}
