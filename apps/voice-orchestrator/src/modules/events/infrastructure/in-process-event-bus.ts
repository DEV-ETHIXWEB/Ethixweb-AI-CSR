import { Inject, Injectable } from "@nestjs/common";
import type { StructuredLogger } from "@ethixweb/shared-kernel";
import { APP_LOGGER } from "../../../shared/observability/app-logger.module";
import type {
  EventBusPort,
  OrchestratorEvent,
  OrchestratorEventHandler,
  OrchestratorEventType,
} from "../domain/orchestrator-event";

/**
 * A subscriber that throws must never break the caller that published —
 * an analytics/logging observer failing is not a reason to fail a live
 * phone call mid-turn. Errors are caught and logged, never propagated.
 */
@Injectable()
export class InProcessEventBus implements EventBusPort {
  private readonly handlers = new Map<OrchestratorEventType, OrchestratorEventHandler[]>();

  constructor(@Inject(APP_LOGGER) private readonly logger: StructuredLogger) {}

  subscribe(type: OrchestratorEventType, handler: OrchestratorEventHandler): void {
    const existing = this.handlers.get(type) ?? [];
    existing.push(handler);
    this.handlers.set(type, existing);
  }

  async publish(event: OrchestratorEvent): Promise<void> {
    for (const handler of this.handlers.get(event.type) ?? []) {
      try {
        await handler(event);
      } catch (error) {
        this.logger.warn("event handler threw — swallowed so it can't break the caller", {
          eventType: event.type,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}
