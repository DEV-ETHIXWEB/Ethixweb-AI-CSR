import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { RedisService } from "../../../shared/redis/redis.service";
import type { CallAdmissionPort } from "../domain/call-admission.port";
import { CapacityExceededError } from "../domain/errors";

/**
 * Same key-scheme discipline as RedisConversationRepository — per-tenant
 * and global counters, atomic check-and-increment via a Lua script so two
 * concurrent admission attempts can never both slip in over the ceiling
 * (the same race `SET NX` closes for conversation creation; a plain
 * `INCR` then check-after would allow exactly that race).
 *
 * TTL exists as a safety net only, not the primary release mechanism —
 * `release()` is the intended path (called from EndConversationUseCase,
 * best-effort, matching that use case's existing pattern for the Call-row
 * close and usage emission). The TTL protects against a reservation never
 * being released at all (a crashed runtime, a lost end-signal) rather than
 * relying on it for the normal happy path — see docs/36 §1's honest
 * accounting of what this protects against vs. what it doesn't.
 */
const RESERVATION_TTL_SECONDS = 4 * 60 * 60; // matches CONVERSATION_TTL_SECONDS — a reservation should never outlive the call it guards
const GLOBAL_COUNTER_KEY = "capacity:global:active";

const RESERVE_SCRIPT = `
local tenantKey = KEYS[1]
local globalKey = KEYS[2]
local reservationKey = KEYS[3]
local maxTenant = tonumber(ARGV[1])
local maxGlobal = tonumber(ARGV[2])
local ttl = tonumber(ARGV[3])
local tenantCeiling = tonumber(ARGV[4])

local tenantActive = tonumber(redis.call("GET", tenantKey) or "0")
local globalActive = tonumber(redis.call("GET", globalKey) or "0")

if tenantActive >= tenantCeiling then
  return "TENANT_FULL"
end
if globalActive >= maxGlobal then
  return "GLOBAL_FULL"
end

redis.call("INCR", tenantKey)
redis.call("EXPIRE", tenantKey, ttl)
redis.call("INCR", globalKey)
redis.call("EXPIRE", globalKey, ttl)
redis.call("SET", reservationKey, "1", "EX", ttl)
return "OK"
`;

const RELEASE_SCRIPT = `
local tenantKey = KEYS[1]
local globalKey = KEYS[2]
local reservationKey = KEYS[3]

local existed = redis.call("GET", reservationKey)
if not existed then
  return "ALREADY_RELEASED"
end
redis.call("DEL", reservationKey)

local tenantActive = tonumber(redis.call("GET", tenantKey) or "0")
if tenantActive > 0 then
  redis.call("DECR", tenantKey)
end
local globalActive = tonumber(redis.call("GET", globalKey) or "0")
if globalActive > 0 then
  redis.call("DECR", globalKey)
end
return "OK"
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
    // ceiling. Both still share the same counter — this is a soft
    // reservation of headroom, not a separate hard-partitioned pool, since
    // over-partitioning would waste capacity on quiet emergency-free days.
    const tenantCeiling = limits.isEmergencyPriority
      ? limits.maxTenantConcurrentCalls
      : Math.max(
          1,
          Math.floor(limits.maxTenantConcurrentCalls * (1 - limits.emergencyHeadroomRatio)),
        );
    const result = await this.redis.eval(
      RESERVE_SCRIPT,
      3,
      this.tenantCounterKey(tenantId),
      GLOBAL_COUNTER_KEY,
      this.reservationKey(tenantId, reservationId),
      String(limits.maxTenantConcurrentCalls),
      String(limits.maxGlobalConcurrentCalls),
      String(RESERVATION_TTL_SECONDS),
      String(tenantCeiling),
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
      3,
      this.tenantCounterKey(tenantId),
      GLOBAL_COUNTER_KEY,
      this.reservationKey(tenantId, reservationId),
    );
  }

  async getActiveCounts(tenantId: string): Promise<{ tenantActive: number; globalActive: number }> {
    const [tenantActive, globalActive] = await Promise.all([
      this.redis.get(this.tenantCounterKey(tenantId)),
      this.redis.get(GLOBAL_COUNTER_KEY),
    ]);
    return {
      tenantActive: Number(tenantActive ?? 0),
      globalActive: Number(globalActive ?? 0),
    };
  }

  private tenantCounterKey(tenantId: string): string {
    return `capacity:tenant:${tenantId}:active`;
  }

  private reservationKey(tenantId: string, reservationId: string): string {
    return `capacity:reservation:${tenantId}:${reservationId}`;
  }
}
