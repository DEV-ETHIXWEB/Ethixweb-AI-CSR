/**
 * Idempotency port used by the tool broker (docs/04-ai-tool-architecture.md §2-3)
 * and CRM/notification writes. `begin` is the atomic reservation step: only the
 * first caller for a given key proceeds, concurrent duplicates are told a result
 * is already in flight, and completed calls return the cached result instead of
 * re-executing — the mechanism, not policy, behind every "never double-create"
 * requirement in the architecture docs.
 */
export type IdempotencyOutcome<T> =
  { status: "proceed" } | { status: "in_flight" } | { status: "completed"; result: T };

export interface IdempotencyBeginOptions {
  /** How long a completed result is cached before the key can be reused. */
  ttlSeconds?: number;
}

export interface IdempotencyStore {
  /** Atomically reserve `key`. Only one caller per key gets `{status: "proceed"}`. */
  begin<T = unknown>(
    key: string,
    options?: IdempotencyBeginOptions,
  ): Promise<IdempotencyOutcome<T>>;
  /** Record the successful result so subsequent `begin` calls return it instead of re-executing. */
  complete(key: string, result: unknown, options?: IdempotencyBeginOptions): Promise<void>;
  /** Release a reservation after a failed attempt so a legitimate retry isn't permanently blocked. */
  release(key: string): Promise<void>;
}
