import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import Redis from "ioredis";

// ioredis's own defaults (maxRetriesPerRequest: 20, no commandTimeout, and
// a separate 10s connectTimeout for the initial handshake) mean both an
// ordinary command AND the very first connection attempt can hang far
// longer than acceptable when Redis is unreachable. Reproduced live twice:
// with Redis stopped after a successful boot, POST /v1/auth/login (rate
// limiter + refresh-token store, both Redis-backed) hung for 30+ seconds
// with no response at all; separately, with REDIS_URL pointed at an
// unreachable host from a cold start, bootstrap hung for the full 10s
// default connectTimeout then crashed with a raw, undiagnosable ioredis
// stack trace. One shared timeout for both cases, matched to this
// service's own request-latency budget rather than ioredis's defaults.
const REDIS_TIMEOUT_MS = 3000;

/**
 * Thin lifecycle wrapper around the ioredis client, the same relationship
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
      maxRetriesPerRequest: 3,
      commandTimeout: REDIS_TIMEOUT_MS,
      connectTimeout: REDIS_TIMEOUT_MS,
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.connect();
    } catch (error) {
      // Without this catch, a failed initial connection surfaces as a raw
      // ioredis internals stack trace with no indication of which
      // dependency failed or that this is a startup connectivity problem
      // rather than an application bug (see this file's own comment on how
      // that was reproduced live). Re-thrown, not swallowed: this service
      // cannot function without Redis (rate limiting, refresh-token
      // revocation, and tool-broker idempotency all depend on it), so
      // failing bootstrap and letting the process manager restart/alert is
      // still the correct outcome, just with a diagnosable log line first.
      this.logger.error(
        `Failed to connect to Redis at startup (unreachable within ${REDIS_TIMEOUT_MS}ms), this service cannot start without it: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw error;
    }
    this.logger.log("Connected to Redis");
  }

  onModuleDestroy(): void {
    this.disconnect();
  }
}
