/**
 * Transactional outbox contracts, per docs/01-architecture-overview.md §5.
 * Intentionally ORM-agnostic: the actual `OutboxWriter` implementation (which
 * must write in the same DB transaction as the domain change) lives in each
 * app's infrastructure layer where the Prisma transaction client is available
 * — this package only defines the shape and the generic relay loop so the
 * polling/publish/mark-dispatched/error-handling logic is written once.
 */
export interface OutboxEventInput {
  tenantId?: string | undefined;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: unknown;
  /** Enforces "publish this event at most once per business action" — see docs/07 §2. */
  dedupKey?: string | undefined;
}

export interface OutboxRecord extends OutboxEventInput {
  id: string;
  createdAt: Date;
}

/** Writes an event as part of the caller's existing transaction. */
export interface OutboxWriter {
  write(event: OutboxEventInput): Promise<void>;
}

export interface OutboxRelayDeps {
  fetchPendingBatch(limit: number): Promise<OutboxRecord[]>;
  publish(record: OutboxRecord): Promise<void>;
  markDispatched(id: string): Promise<void>;
  onError?(record: OutboxRecord, error: unknown): void;
}

export interface OutboxRelayResult {
  processed: number;
  dispatched: number;
  failed: number;
}

/**
 * Runs one relay pass: fetch pending events, publish each, mark dispatched.
 * A single record's publish failure does not stop the batch — every other
 * pending record still gets a chance this pass, and the failed one remains
 * `pending` for the next poll (retry architecture, docs/01 §6).
 */
export async function relayOutboxBatch(
  deps: OutboxRelayDeps,
  batchSize = 50,
): Promise<OutboxRelayResult> {
  const pending = await deps.fetchPendingBatch(batchSize);
  let dispatched = 0;
  let failed = 0;

  for (const record of pending) {
    try {
      await deps.publish(record);
      await deps.markDispatched(record.id);
      dispatched += 1;
    } catch (error) {
      failed += 1;
      deps.onError?.(record, error);
    }
  }

  return { processed: pending.length, dispatched, failed };
}
