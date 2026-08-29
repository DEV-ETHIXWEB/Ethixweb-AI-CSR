import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import Redis from "ioredis";

// ioredis's own defaults (maxRetriesPerRequest: 20, no commandTimeout, and
// a separate 10s connectTimeout for the initial handshake) mean both an
// ordinary command AND the very first connection attempt can hang far
// longer than acceptable when Redis is unreachable, and this service is
// entirely Redis-backed (conversation state, capacity reservations,
// idempotency store, tool audit log) so both cases are directly on the
// live-call path. Reproduced live: with REDIS_URL pointed at an
// unreachable host from a cold start, bootstrap hung for the full 10s
// default connectTimeout then crashed with a raw, undiagnosable ioredis
// stack trace, not a clean, actionable failure. Matches core-api's own
// RedisService fix for the same class of bug (found there first).
const REDIS_TIMEOUT_MS = 3000;

/**
 * This service's ONLY state store, voice-orchestrator is deliberately
 * Postgres-free (docs/01 §9's deployment diagram has no edge from the
 * voice-orchestrator ECS service to RDS, only to ElastiCache/Redis).
 * Conversation state lives here for the duration of a call; durable
 * cross-call persistence (Transcript/ToolCall/VoiceSession Prisma rows)
 * belongs to the future `calls` module (docs/13, Phase 10) once it exists
 * to create the `Call` row those tables foreign-key against, see
 * modules/conversation/infrastructure/redis-conversation.repository.ts's
 * own comment for the full reasoning.
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
      // cannot function without Redis at all, so failing bootstrap and
      // letting the process manager restart/alert is still the correct
      // outcome, just with a diagnosable log line first.
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
