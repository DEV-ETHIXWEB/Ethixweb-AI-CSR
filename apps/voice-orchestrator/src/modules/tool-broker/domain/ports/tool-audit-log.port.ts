/**
 * The Postgres `ToolCall` table (packages/database/prisma/schema.prisma)
 * is docs/04 §2 stage 6's real audit destination — but it foreign-keys to
 * `calls.id`, and no `Call` row exists yet (the `calls` module is Phase
 * 10, not this phase — see RedisService's own comment for the identical
 * reasoning applied to conversation persistence). This port's Redis-backed
 * implementation is a real, working, TTL'd audit trail usable TODAY for
 * "why did the AI do X" debugging during this phase; swapping to a
 * Postgres-backed implementation once a real Call row exists is additive,
 * not a rewrite — the port doesn't change.
 */
export interface ToolCallAuditRecord {
  tenantId: string;
  callId: string;
  toolName: string;
  input: unknown;
  output?: unknown;
  status: "success" | "degraded";
  durationMs: number;
  idempotencyKey: string;
  errorMessage?: string;
  createdAt: string;
}

export interface ToolAuditLogPort {
  record(entry: ToolCallAuditRecord): Promise<void>;
}

export const TOOL_AUDIT_LOG = Symbol("TOOL_AUDIT_LOG");
