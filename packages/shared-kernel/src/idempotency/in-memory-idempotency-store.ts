import type {
  IdempotencyBeginOptions,
  IdempotencyOutcome,
  IdempotencyStore,
} from "./idempotency-store";

interface Entry {
  status: "in_flight" | "completed";
  result?: unknown;
  expiresAt: number;
}

const DEFAULT_TTL_SECONDS = 86_400;

/**
 * Process-local implementation for unit tests and single-instance local dev.
 * Production deployments use {@link RedisIdempotencyStore} — this is not a
 * placeholder for it, it's a genuinely correct implementation of the same
 * port for contexts where a shared store isn't needed or available.
 */
export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly entries = new Map<string, Entry>();

  async begin<T = unknown>(
    key: string,
    options: IdempotencyBeginOptions = {},
  ): Promise<IdempotencyOutcome<T>> {
    this.purgeIfExpired(key);
    const existing = this.entries.get(key);

    if (!existing) {
      this.entries.set(key, {
        status: "in_flight",
        expiresAt: Date.now() + (options.ttlSeconds ?? DEFAULT_TTL_SECONDS) * 1000,
      });
      return { status: "proceed" };
    }

    if (existing.status === "in_flight") {
      return { status: "in_flight" };
    }

    return { status: "completed", result: existing.result as T };
  }

  async complete(
    key: string,
    result: unknown,
    options: IdempotencyBeginOptions = {},
  ): Promise<void> {
    this.entries.set(key, {
      status: "completed",
      result,
      expiresAt: Date.now() + (options.ttlSeconds ?? DEFAULT_TTL_SECONDS) * 1000,
    });
  }

  async release(key: string): Promise<void> {
    const existing = this.entries.get(key);
    if (existing?.status === "in_flight") {
      this.entries.delete(key);
    }
  }

  private purgeIfExpired(key: string): void {
    const existing = this.entries.get(key);
    if (existing && existing.expiresAt <= Date.now()) {
      this.entries.delete(key);
    }
  }
}
