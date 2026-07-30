import type { OutboxWriter } from "@ethixweb/shared-kernel";
import type { Prisma, PrismaClient } from "@ethixweb/database";

export type Db = PrismaClient | Prisma.TransactionClient;

/**
 * `PrismaOutboxWriter` needs a `db` handle bound at construction (the
 * outbox write must happen in the caller's own in-flight transaction — see
 * its own comment) — this factory is the DI-injectable seam a use-case
 * depends on instead of importing `PrismaOutboxWriter` and constructing it
 * inline, which would hard-wire the use-case to Prisma and make it
 * untestable without a real database connection.
 */
export interface OutboxWriterFactory {
  forDb(db: Db): OutboxWriter;
}

export const OUTBOX_WRITER_FACTORY = Symbol("OUTBOX_WRITER_FACTORY");
