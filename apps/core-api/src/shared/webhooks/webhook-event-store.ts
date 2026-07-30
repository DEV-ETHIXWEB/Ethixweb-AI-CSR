import type { Prisma, PrismaClient } from "@ethixweb/database";

export type Db = PrismaClient | Prisma.TransactionClient;

/**
 * The durable, provider-agnostic replay backstop named in
 * hmac-signature.util.ts's own security-review comment: `webhook_events`
 * (docs/01-architecture-overview.md §7), `UNIQUE(provider, provider_event_id)`.
 * Every real webhook receiver in this codebase should go through this, not
 * re-derive its own dedup table.
 */
export interface WebhookEventStore {
  /**
   * Attempts to record this (provider, providerEventId) pair. Returns
   * `false` if it was already recorded (a genuine duplicate delivery — at
   * -least-once delivery is the assumed default per docs/05 §2.6, so this
   * is the normal, expected path on a redelivery, not an error condition)
   * and `true` if this is the first time it's been seen.
   */
  recordIfNew(
    db: Db,
    provider: string,
    providerEventId: string,
    payload: unknown,
    tenantId?: string,
  ): Promise<boolean>;
}

export const WEBHOOK_EVENT_STORE = Symbol("WEBHOOK_EVENT_STORE");
