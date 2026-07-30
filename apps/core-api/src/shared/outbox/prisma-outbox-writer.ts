import type { OutboxEventInput, OutboxWriter } from "@ethixweb/shared-kernel";
import type { Prisma, PrismaClient } from "@ethixweb/database";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Concrete, Prisma-backed implementation of shared-kernel's ORM-agnostic
 * `OutboxWriter` port (docs/01-architecture-overview.md §5). Constructed
 * with the caller's own `db` handle (plain client or an in-flight
 * transaction client), not injected as a NestJS singleton — the entire
 * point of the outbox pattern is that the event write happens in the SAME
 * transaction as the domain change it describes, so a use-case constructs
 * `new PrismaOutboxWriter(db)` with whatever transaction-scoped `db` it's
 * already using, right where it calls `.write(...)`.
 */
export class PrismaOutboxWriter implements OutboxWriter {
  constructor(private readonly db: Db) {}

  async write(event: OutboxEventInput): Promise<void> {
    await this.db.outboxEvent.create({
      data: {
        tenantId: event.tenantId ?? null,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        eventType: event.eventType,
        payload: event.payload as Prisma.InputJsonValue,
        dedupKey: event.dedupKey ?? null,
      },
    });
  }
}
