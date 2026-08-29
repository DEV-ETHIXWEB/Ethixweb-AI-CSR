import IoRedisMock from "ioredis-mock";
import type { RedisService } from "../../../shared/redis/redis.service";
import type { ToolCallAuditRecord } from "../domain/ports/tool-audit-log.port";
import { RedisToolAuditLogAdapter } from "./redis-tool-audit-log.adapter";

const SEVEN_DAYS_SECONDS = 7 * 24 * 60 * 60;

function buildRecord(overrides: Partial<ToolCallAuditRecord> = {}): ToolCallAuditRecord {
  return {
    tenantId: "tenant-a",
    callId: "call-1",
    toolName: "createLead",
    input: { problemSummary: "burst pipe" },
    output: { leadId: "lead-1" },
    status: "success",
    durationMs: 120,
    idempotencyKey: "tool:call-1:createLead:abc123",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("RedisToolAuditLogAdapter", () => {
  let redis: RedisService;
  let adapter: RedisToolAuditLogAdapter;

  beforeEach(async () => {
    redis = new IoRedisMock() as unknown as RedisService;
    await redis.flushall();
    adapter = new RedisToolAuditLogAdapter(redis);
  });

  it("appends the record as JSON to a per-tenant-per-call list", async () => {
    const record = buildRecord();
    await adapter.record(record);

    const stored = await redis.lrange("tool-audit:tenant-a:call-1", 0, -1);
    expect(stored).toEqual([JSON.stringify(record)]);
  });

  it("appends multiple records for the same call in call order, without overwriting earlier ones", async () => {
    const first = buildRecord({ toolName: "createLead", createdAt: "2026-01-01T00:00:00.000Z" });
    const second = buildRecord({ toolName: "escalateEmergency", createdAt: "2026-01-01T00:00:01.000Z" });
    await adapter.record(first);
    await adapter.record(second);

    const stored = await redis.lrange("tool-audit:tenant-a:call-1", 0, -1);
    expect(stored).toEqual([JSON.stringify(first), JSON.stringify(second)]);
  });

  it("keeps different calls' audit trails in separate lists, even for the same tenant", async () => {
    await adapter.record(buildRecord({ callId: "call-1" }));
    await adapter.record(buildRecord({ callId: "call-2" }));

    expect(await redis.lrange("tool-audit:tenant-a:call-1", 0, -1)).toHaveLength(1);
    expect(await redis.lrange("tool-audit:tenant-a:call-2", 0, -1)).toHaveLength(1);
  });

  it("keeps different tenants' audit trails isolated, even for the identically-named callId", async () => {
    await adapter.record(buildRecord({ tenantId: "tenant-a", callId: "call-1" }));
    await adapter.record(buildRecord({ tenantId: "tenant-b", callId: "call-1" }));

    expect(await redis.lrange("tool-audit:tenant-a:call-1", 0, -1)).toHaveLength(1);
    expect(await redis.lrange("tool-audit:tenant-b:call-1", 0, -1)).toHaveLength(1);
  });

  it("sets a 7-day TTL on the list key so audit trails don't accumulate forever", async () => {
    await adapter.record(buildRecord());

    const ttl = await redis.ttl("tool-audit:tenant-a:call-1");
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(SEVEN_DAYS_SECONDS);
  });
});
