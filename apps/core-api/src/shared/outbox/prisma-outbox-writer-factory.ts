import { Injectable } from "@nestjs/common";
import type { OutboxWriter } from "@ethixweb/shared-kernel";
import type { Db, OutboxWriterFactory } from "./outbox-writer-factory";
import { PrismaOutboxWriter } from "./prisma-outbox-writer";

@Injectable()
export class PrismaOutboxWriterFactory implements OutboxWriterFactory {
  forDb(db: Db): OutboxWriter {
    return new PrismaOutboxWriter(db);
  }
}
