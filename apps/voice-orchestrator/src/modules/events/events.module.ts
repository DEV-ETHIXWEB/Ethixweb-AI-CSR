import { Global, Module } from "@nestjs/common";
import { EVENT_BUS } from "./domain/orchestrator-event";
import { InProcessEventBus } from "./infrastructure/in-process-event-bus";

@Global()
@Module({
  providers: [{ provide: EVENT_BUS, useClass: InProcessEventBus }],
  exports: [EVENT_BUS],
})
export class EventsModule {}
