import RedisMock from "ioredis-mock";
import { describe, expect, it } from "vitest";
import { RedisIdempotencyStore } from "../src/idempotency/redis-idempotency-store";

// ioredis-mock implements enough of the ioredis surface (SET with EX/NX, GET, DEL)
// for this store's contract to be exercised without a live Redis instance.
//
// It also, like a real Redis server multiple clients connect to, shares its
// in-memory dataset across every `new RedisMock()` instance by default —
// `new RedisMock()` per test is NOT test isolation on its own. `flushall()`
// is what actually gives each test a clean slate (found by an earlier run of
// this exact suite leaking a completed key into the next test).
async function createStore(): Promise<RedisIdempotencyStore> {
  const redis = new RedisMock();
  await redis.flushall();
  return new RedisIdempotencyStore(redis as never);
}

describe("RedisIdempotencyStore", () => {
  it("lets the first caller proceed and blocks a concurrent duplicate", async () => {
    const store = await createStore();
    const first = await store.begin("call-1:createLead");
    expect(first.status).toBe("proceed");

    const second = await store.begin("call-1:createLead");
    expect(second.status).toBe("in_flight");
  });

  it("returns the cached result after completion instead of re-executing", async () => {
    const store = await createStore();
    await store.begin("call-1:createLead");
    await store.complete("call-1:createLead", { leadId: "lead-123" });

    const outcome = await store.begin<{ leadId: string }>("call-1:createLead");
    expect(outcome).toEqual({ status: "completed", result: { leadId: "lead-123" } });
  });

  it("releases the reservation on failure, allowing a real retry", async () => {
    const store = await createStore();
    await store.begin("call-1:createLead");
    await store.release("call-1:createLead");

    const outcome = await store.begin("call-1:createLead");
    expect(outcome.status).toBe("proceed");
  });
});
