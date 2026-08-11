import IoRedisMock from "ioredis-mock";
import type { RedisService } from "../../../shared/redis/redis.service";
import { CapacityExceededError } from "../domain/errors";
import { RedisCallAdmissionAdapter } from "./redis-call-admission.adapter";

const NORMAL_LIMITS = {
  maxTenantConcurrentCalls: 3,
  maxGlobalConcurrentCalls: 100,
  emergencyHeadroomRatio: 0,
  isEmergencyPriority: false,
};

describe("RedisCallAdmissionAdapter", () => {
  let redis: RedisService;
  let adapter: RedisCallAdmissionAdapter;

  beforeEach(async () => {
    redis = new IoRedisMock() as unknown as RedisService;
    await redis.flushall();
    adapter = new RedisCallAdmissionAdapter(redis);
  });

  it("admits a call when there is room and reports it in getActiveCounts", async () => {
    const { reservationId } = await adapter.reserve("tenant-a", "biz-a", NORMAL_LIMITS);
    expect(reservationId).toBeTruthy();
    const counts = await adapter.getActiveCounts("tenant-a");
    expect(counts).toEqual({ tenantActive: 1, globalActive: 1 });
  });

  it("throws CapacityExceededError with scope=tenant once the tenant ceiling is reached", async () => {
    await adapter.reserve("tenant-a", "biz-a", NORMAL_LIMITS);
    await adapter.reserve("tenant-a", "biz-a", NORMAL_LIMITS);
    await adapter.reserve("tenant-a", "biz-a", NORMAL_LIMITS);

    await expect(adapter.reserve("tenant-a", "biz-a", NORMAL_LIMITS)).rejects.toThrow(
      CapacityExceededError,
    );
    await expect(adapter.reserve("tenant-a", "biz-a", NORMAL_LIMITS)).rejects.toMatchObject({
      scope: "tenant",
    });
  });

  it("throws CapacityExceededError with scope=global once the global ceiling is reached, even with tenant room left", async () => {
    const tightGlobal = {
      ...NORMAL_LIMITS,
      maxTenantConcurrentCalls: 100,
      maxGlobalConcurrentCalls: 2,
    };
    await adapter.reserve("tenant-a", "biz-a", tightGlobal);
    await adapter.reserve("tenant-b", "biz-b", tightGlobal);

    await expect(adapter.reserve("tenant-c", "biz-c", tightGlobal)).rejects.toMatchObject({
      scope: "global",
    });
  });

  it("release() frees the slot so a subsequent reserve() can succeed", async () => {
    const { reservationId } = await adapter.reserve("tenant-a", "biz-a", {
      ...NORMAL_LIMITS,
      maxTenantConcurrentCalls: 1,
    });
    await expect(
      adapter.reserve("tenant-a", "biz-a", { ...NORMAL_LIMITS, maxTenantConcurrentCalls: 1 }),
    ).rejects.toThrow(CapacityExceededError);

    await adapter.release("tenant-a", reservationId);

    const { reservationId: second } = await adapter.reserve("tenant-a", "biz-a", {
      ...NORMAL_LIMITS,
      maxTenantConcurrentCalls: 1,
    });
    expect(second).toBeTruthy();
  });

  it("release() is idempotent — calling it twice for the same reservation does not double-decrement (would otherwise let extra calls in)", async () => {
    const { reservationId } = await adapter.reserve("tenant-a", "biz-a", {
      ...NORMAL_LIMITS,
      maxTenantConcurrentCalls: 1,
    });
    await adapter.release("tenant-a", reservationId);
    await adapter.release("tenant-a", reservationId);

    const counts = await adapter.getActiveCounts("tenant-a");
    expect(counts.tenantActive).toBe(0);
  });

  it("tenant isolation: tenant B's calls never count against tenant A's ceiling", async () => {
    await adapter.reserve("tenant-a", "biz-a", { ...NORMAL_LIMITS, maxTenantConcurrentCalls: 1 });
    // tenant-b should still be admitted even though tenant-a is full.
    const { reservationId } = await adapter.reserve("tenant-b", "biz-b", {
      ...NORMAL_LIMITS,
      maxTenantConcurrentCalls: 1,
    });
    expect(reservationId).toBeTruthy();
  });

  describe("emergency headroom", () => {
    it("caps a NORMAL call below maxTenantConcurrentCalls when headroom is reserved", async () => {
      // maxTenant=10, headroom=0.3 -> normal ceiling = floor(10 * 0.7) = 7
      const limits = {
        ...NORMAL_LIMITS,
        maxTenantConcurrentCalls: 10,
        emergencyHeadroomRatio: 0.3,
      };
      for (let i = 0; i < 7; i++) {
        await adapter.reserve("tenant-a", "biz-a", limits);
      }
      await expect(adapter.reserve("tenant-a", "biz-a", limits)).rejects.toMatchObject({
        scope: "tenant",
      });
    });

    it("an emergency-priority call can use the headroom band a normal call cannot", async () => {
      const limits = {
        ...NORMAL_LIMITS,
        maxTenantConcurrentCalls: 10,
        emergencyHeadroomRatio: 0.3,
      };
      for (let i = 0; i < 7; i++) {
        await adapter.reserve("tenant-a", "biz-a", limits);
      }
      const { reservationId } = await adapter.reserve("tenant-a", "biz-a", {
        ...limits,
        isEmergencyPriority: true,
      });
      expect(reservationId).toBeTruthy();
    });

    it("even emergency-priority calls are still capped at the full maxTenantConcurrentCalls — headroom is not unlimited", async () => {
      const limits = { ...NORMAL_LIMITS, maxTenantConcurrentCalls: 3, emergencyHeadroomRatio: 0.3 };
      for (let i = 0; i < 3; i++) {
        await adapter.reserve("tenant-a", "biz-a", { ...limits, isEmergencyPriority: true });
      }
      await expect(
        adapter.reserve("tenant-a", "biz-a", { ...limits, isEmergencyPriority: true }),
      ).rejects.toThrow(CapacityExceededError);
    });
  });

  it("concurrent reserve() calls at the ceiling never admit more than the configured limit (no over-admission race)", async () => {
    const limits = { ...NORMAL_LIMITS, maxTenantConcurrentCalls: 5 };
    const attempts = await Promise.allSettled(
      Array.from({ length: 10 }, () => adapter.reserve("tenant-a", "biz-a", limits)),
    );
    const admitted = attempts.filter((a) => a.status === "fulfilled");
    const rejected = attempts.filter((a) => a.status === "rejected");
    expect(admitted).toHaveLength(5);
    expect(rejected).toHaveLength(5);
  });
});
