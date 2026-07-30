import type { OutboxEventInput, OutboxWriter } from "@ethixweb/shared-kernel";
import type { OutboxWriterFactory } from "../../../../shared/outbox/outbox-writer-factory";

export class FakeOutboxWriterFactory implements OutboxWriterFactory {
  readonly writtenEvents: OutboxEventInput[] = [];

  forDb(): OutboxWriter {
    return {
      write: async (event) => {
        this.writtenEvents.push(event);
      },
    };
  }
}
