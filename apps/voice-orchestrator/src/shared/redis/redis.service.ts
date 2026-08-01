import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import Redis from "ioredis";

/**
 * This service's ONLY state store — voice-orchestrator is deliberately
 * Postgres-free (docs/01 §9's deployment diagram has no edge from the
 * voice-orchestrator ECS service to RDS, only to ElastiCache/Redis).
 * Conversation state lives here for the duration of a call; durable
 * cross-call persistence (Transcript/ToolCall/VoiceSession Prisma rows)
 * belongs to the future `calls` module (docs/13, Phase 10) once it exists
 * to create the `Call` row those tables foreign-key against — see
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
    super(url, { lazyConnect: true });
  }

  async onModuleInit(): Promise<void> {
    await this.connect();
    this.logger.log("Connected to Redis");
  }

  onModuleDestroy(): void {
    this.disconnect();
  }
}
