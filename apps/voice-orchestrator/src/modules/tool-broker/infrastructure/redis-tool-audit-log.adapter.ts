import { Injectable } from "@nestjs/common";
import { RedisService } from "../../../shared/redis/redis.service";
import type { ToolAuditLogPort, ToolCallAuditRecord } from "../domain/ports/tool-audit-log.port";

const AUDIT_TTL_SECONDS = 7 * 24 * 60 * 60;
const KEY_PREFIX = "tool-audit:";

/** See ToolAuditLogPort's own comment on why this is Redis-backed rather than the Postgres `ToolCall` table for now. Stored as a per-call list (`RPUSH`), one list per `callId`, TTL'd. */
@Injectable()
export class RedisToolAuditLogAdapter implements ToolAuditLogPort {
  constructor(private readonly redis: RedisService) {}

  async record(entry: ToolCallAuditRecord): Promise<void> {
    const key = `${KEY_PREFIX}${entry.tenantId}:${entry.callId}`;
    await this.redis.rpush(key, JSON.stringify(entry));
    await this.redis.expire(key, AUDIT_TTL_SECONDS);
  }
}
