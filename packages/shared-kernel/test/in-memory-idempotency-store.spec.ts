import { describe, expect, it } from "vitest";
import { InMemoryIdempotencyStore } from "../src/idempotency/in-memory-idempotency-store";

describe("InMemoryIdempotencyStore", () => {
  it("lets the first caller proceed for a fresh key", async () => {
    const store = new InMemoryIdempotencyStore();
    const outcome = await store.begin("call-1:createLead");
    expect(outcome.status).toBe("proceed");
  });

  it("tells a concurrent caller the key is in flight", async () => {
    const store = new InMemoryIdempotencyStore();
    await store.begin("call-1:createLead");
    const second = await store.begin("call-1:createLead");
    expect(second.status).toBe("in_flight");
  });

  it("returns the cached result once the operation completes, without re-executing", async () => {
    const store = new InMemoryIdempotencyStore();
    await store.begin("call-1:createLead");
    await store.complete("call-1:createLead", { leadId: "lead-123" });

    const outcome = await store.begin<{ leadId: string }>("call-1:createLead");
    expect(outcome).toEqual({ status: "completed", result: { leadId: "lead-123" } });
  });

  it("releases the reservation on failure so a retry can proceed", async () => {
    const store = new InMemoryIdempotencyStore();
    await store.begin("call-1:createLead");
    await store.release("call-1:createLead");

    const outcome = await store.begin("call-1:createLead");
    expect(outcome.status).toBe("proceed");
  });

  it("does not release a key that already completed (guards against a stale caller clobbering a real result)", async () => {
    const store = new InMemoryIdempotencyStore();
    await store.begin("call-1:createLead");
    await store.complete("call-1:createLead", { leadId: "lead-123" });
    await store.release("call-1:createLead");

    const outcome = await store.begin<{ leadId: string }>("call-1:createLead");
    expect(outcome).toEqual({ status: "completed", result: { leadId: "lead-123" } });
  });

  it("expires a reservation after its TTL, allowing a new attempt", async () => {
    const store = new InMemoryIdempotencyStore();
    await store.begin("call-1:createLead", { ttlSeconds: 0.01 });
    await new Promise((resolve) => setTimeout(resolve, 20));

    const outcome = await store.begin("call-1:createLead");
    expect(outcome.status).toBe("proceed");
  });
});
