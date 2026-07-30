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
