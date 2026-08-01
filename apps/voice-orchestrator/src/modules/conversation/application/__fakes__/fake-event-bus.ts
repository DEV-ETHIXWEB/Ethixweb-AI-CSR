import type {
  EventBusPort,
  OrchestratorEvent,
  OrchestratorEventType,
} from "../../../events/domain/orchestrator-event";

export class FakeEventBus implements EventBusPort {
  readonly published: OrchestratorEvent[] = [];

  async publish(event: OrchestratorEvent): Promise<void> {
    this.published.push(event);
  }

  subscribe(_type: OrchestratorEventType): void {
    // Unused by HandleTurnUseCase's own tests — it only publishes.
  }

  eventsOfType(type: OrchestratorEventType): OrchestratorEvent[] {
    return this.published.filter((event) => event.type === type);
  }
}
