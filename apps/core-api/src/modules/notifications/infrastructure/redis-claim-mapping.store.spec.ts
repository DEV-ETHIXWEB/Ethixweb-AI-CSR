import IoRedisMock from "ioredis-mock";
import type { RedisService } from "../../../shared/redis/redis.service";
import { RedisClaimMappingStore } from "./redis-claim-mapping.store";

describe("RedisClaimMappingStore", () => {
  let redis: RedisService;
  let store: RedisClaimMappingStore;

  beforeEach(async () => {
    redis = new IoRedisMock() as unknown as RedisService;
    await redis.flushall();
    store = new RedisClaimMappingStore(redis);
  });

  it("round-trips a remembered mapping", async () => {
    await store.remember("+15551234567", {
      tenantId: "tenant-1",
      leadId: "lead-1",
      userId: "user-1",
    });

    const resolved = await store.resolve("+15551234567");

    expect(resolved).toEqual({ tenantId: "tenant-1", leadId: "lead-1", userId: "user-1" });
  });

  it("returns null for a phone number with no mapping", async () => {
    const resolved = await store.resolve("+15559999999");

    expect(resolved).toBeNull();
  });

  it("a later remember() for the same phone overwrites the earlier mapping (most-recent-open-lead semantics)", async () => {
    await store.remember("+15551234567", {
      tenantId: "tenant-1",
      leadId: "lead-1",
      userId: "user-1",
    });
    await store.remember("+15551234567", {
      tenantId: "tenant-1",
      leadId: "lead-2",
      userId: "user-1",
    });

    const resolved = await store.resolve("+15551234567");

    expect(resolved?.leadId).toBe("lead-2");
  });
});
