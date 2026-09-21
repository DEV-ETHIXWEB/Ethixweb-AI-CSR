import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { RedisService } from "../../../shared/redis/redis.service";
import type { CallAdmissionPort } from "../domain/call-admission.port";
import { CapacityExceededError } from "../domain/errors";

/**
 * Per-tenant and global admission, atomic check-and-add via a Lua script so
 * two concurrent attempts can never both slip in over the ceiling.
 *
 * Each live call is one member of a sorted set, scored by the moment its
 * reservation expires. The active count is the size of the set AFTER expired
 * members are purged, on every reserve and every read.
 *
 * Why not a counter: this used to be an INCR/DECR counter plus a separate
 * reservation key with a 4 hour TTL. When a call never reached release() (a
 * hang-up during call start, a crashed runtime) its reservation key expired
 * on its own but the counter was never decremented, so the counter drifted
 * upward until it hit the tenant ceiling and every new caller was rejected
 * with "capacity exceeded" while no call was actually live. That took the
 * phone line down on production with the counter at 8, six reservation keys
 * and zero real calls. A set has no separate counter to drift: a leaked slot
 * simply ages out.
 *
 * TTL is the safety net, not the release path: release() (EndConversation)
 * is still the normal way a slot frees. 45 minutes is well past a normal
 * plumbing call; the cost of a longer call is that its slot frees early,
 * which is a small over-admission, where the cost of a long TTL was the line
 * staying down for hours.
 */
const RESERVATION_TTL_MS = 45 * 60 * 1000;
const GLOBAL_KEY = "capacity:global:calls";

const RESERVE_SCRIPT = `
local tenantKey = KEYS[1]
local globalKey = KEYS[2]
local member = ARGV[1]
local globalMember = ARGV[2]
local now = tonumber(ARGV[3])
local expiresAt = tonumber(ARGV[4])
local maxGlobal = tonumber(ARGV[5])
local tenantCeiling = tonumber(ARGV[6])
local keyTtlSeconds = tonumber(ARGV[7])

redis.call("ZREMRANGEBYSCORE", tenantKey, "-inf", now)
redis.call("ZREMRANGEBYSCORE", globalKey, "-inf", now)

if redis.call("ZCARD", tenantKey) >= tenantCeiling then
  return "TENANT_FULL"
end
if redis.call("ZCARD", globalKey) >= maxGlobal then
  return "GLOBAL_FULL"
end

redis.call("ZADD", tenantKey, expiresAt, member)
redis.call("EXPIRE", tenantKey, keyTtlSeconds)
redis.call("ZADD", globalKey, expiresAt, globalMember)
redis.call("EXPIRE", globalKey, keyTtlSeconds)
return "OK"
`;

const RELEASE_SCRIPT = `
local removed = redis.call("ZREM", KEYS[1], ARGV[1])
redis.call("ZREM", KEYS[2], ARGV[2])
if removed == 0 then
  return "ALREADY_RELEASED"
end
return "OK"
`;

const COUNT_SCRIPT = `
local now = tonumber(ARGV[1])
redis.call("ZREMRANGEBYSCORE", KEYS[1], "-inf", now)
redis.call("ZREMRANGEBYSCORE", KEYS[2], "-inf", now)
return { redis.call("ZCARD", KEYS[1]), redis.call("ZCARD", KEYS[2]) }
`;

@Injectable()
export class RedisCallAdmissionAdapter implements CallAdmissionPort {
  constructor(private readonly redis: RedisService) {}

  async reserve(
    tenantId: string,
    _businessId: string,
    limits: {
      maxTenantConcurrentCalls: number;
      maxGlobalConcurrentCalls: number;
      emergencyHeadroomRatio: number;
      isEmergencyPriority: boolean;
    },
  ): Promise<{ reservationId: string }> {
    const reservationId = randomUUID();
    // A normal call is capped BELOW maxTenantConcurrentCalls, leaving the
    // headroom band free; an emergency-priority call may use the full
    // ceiling. Both share the same set: this is a soft reservation of
    // headroom, not a separate hard-partitioned pool, since
    // over-partitioning would waste capacity on quiet emergency-free days.
    const tenantCeiling = limits.isEmergencyPriority
      ? limits.maxTenantConcurrentCalls
      : Math.max(
          1,
          Math.floor(limits.maxTenantConcurrentCalls * (1 - limits.emergencyHeadroomRatio)),
        );
    const now = Date.now();
    const result = await this.redis.eval(
      RESERVE_SCRIPT,
      2,
      this.tenantKey(tenantId),
      GLOBAL_KEY,
      reservationId,
      `${tenantId}:${reservationId}`,
      String(now),
      String(now + RESERVATION_TTL_MS),
      String(limits.maxGlobalConcurrentCalls),
      String(tenantCeiling),
      String(Math.ceil((RESERVATION_TTL_MS * 2) / 1000)),
    );

    if (result === "TENANT_FULL") {
      throw new CapacityExceededError(tenantId, "tenant");
    }
    if (result === "GLOBAL_FULL") {
      throw new CapacityExceededError(tenantId, "global");
    }
    return { reservationId };
  }

  async release(tenantId: string, reservationId: string): Promise<void> {
    await this.redis.eval(
      RELEASE_SCRIPT,
      2,
      this.tenantKey(tenantId),
      GLOBAL_KEY,
      reservationId,
      `${tenantId}:${reservationId}`,
    );
  }

  async getActiveCounts(tenantId: string): Promise<{ tenantActive: number; globalActive: number }> {
    const result = (await this.redis.eval(
      COUNT_SCRIPT,
      2,
      this.tenantKey(tenantId),
      GLOBAL_KEY,
      String(Date.now()),
    )) as [number, number];
    return { tenantActive: Number(result[0] ?? 0), globalActive: Number(result[1] ?? 0) };
  }

  private tenantKey(tenantId: string): string {
    return `capacity:tenant:${tenantId}:calls`;
  }
}
