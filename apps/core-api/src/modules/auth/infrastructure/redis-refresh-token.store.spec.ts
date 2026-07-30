import RedisMock from "ioredis-mock";
import type { RedisService } from "../../../shared/redis/redis.service";
import { RedisRefreshTokenStore } from "./redis-refresh-token.store";

// See packages/shared-kernel/test/redis-idempotency-store.spec.ts for why
// flushall() is required for real per-test isolation with ioredis-mock.
async function createStore(): Promise<RedisRefreshTokenStore> {
  const redis = new RedisMock();
  await redis.flushall();
  return new RedisRefreshTokenStore(redis as unknown as RedisService);
}

describe("RedisRefreshTokenStore", () => {
  it("a stored token is valid for its exact user and jti", async () => {
    const store = await createStore();
    await store.store("user-1", "jti-1", 3600);

    expect(await store.isValid("user-1", "jti-1")).toBe(true);
  });

  it("a token is invalid for the wrong user, even with the right jti", async () => {
    const store = await createStore();
    await store.store("user-1", "jti-1", 3600);

    expect(await store.isValid("user-2", "jti-1")).toBe(false);
  });

  it("a never-stored jti is invalid", async () => {
    const store = await createStore();
    expect(await store.isValid("user-1", "never-stored")).toBe(false);
  });

  it("revoke() invalidates exactly the targeted token", async () => {
    const store = await createStore();
    await store.store("user-1", "jti-1", 3600);
    await store.store("user-1", "jti-2", 3600);

    await store.revoke("user-1", "jti-1");

    expect(await store.isValid("user-1", "jti-1")).toBe(false);
    expect(await store.isValid("user-1", "jti-2")).toBe(true);
  });

  it("revokeAll() invalidates every token for that user, and only that user", async () => {
    const store = await createStore();
    await store.store("user-1", "jti-1", 3600);
    await store.store("user-1", "jti-2", 3600);
    await store.store("user-2", "jti-3", 3600);

    await store.revokeAll("user-1");

    expect(await store.isValid("user-1", "jti-1")).toBe(false);
    expect(await store.isValid("user-1", "jti-2")).toBe(false);
    expect(await store.isValid("user-2", "jti-3")).toBe(true);
  });

  it("revokeAll() on a user with no active tokens is a safe no-op", async () => {
    const store = await createStore();
    await expect(store.revokeAll("user-with-no-tokens")).resolves.toBeUndefined();
  });
});
