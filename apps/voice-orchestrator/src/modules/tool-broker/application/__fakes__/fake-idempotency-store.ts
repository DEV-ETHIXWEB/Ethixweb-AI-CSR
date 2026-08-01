import type {
  IdempotencyBeginOptions,
  IdempotencyOutcome,
  IdempotencyStore,
} from "@ethixweb/shared-kernel";

export class FakeIdempotencyStore implements IdempotencyStore {
  private readonly completed = new Map<string, unknown>();
  private readonly inFlight = new Set<string>();

  async begin<T = unknown>(
    key: string,
    _options?: IdempotencyBeginOptions,
  ): Promise<IdempotencyOutcome<T>> {
    if (this.completed.has(key)) {
      return { status: "completed", result: this.completed.get(key) as T };
    }
    if (this.inFlight.has(key)) {
      return { status: "in_flight" };
    }
    this.inFlight.add(key);
    return { status: "proceed" };
  }

  async complete(key: string, result: unknown, _options?: IdempotencyBeginOptions): Promise<void> {
    this.completed.set(key, result);
    this.inFlight.delete(key);
  }

  async release(key: string): Promise<void> {
    this.inFlight.delete(key);
  }
}
