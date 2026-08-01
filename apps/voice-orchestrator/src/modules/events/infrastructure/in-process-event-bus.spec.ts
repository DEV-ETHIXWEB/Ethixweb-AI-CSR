import { createNoopLogger } from "../../tool-broker/application/__fakes__/fake-logger";
import type { OrchestratorEvent } from "../domain/orchestrator-event";
import { InProcessEventBus } from "./in-process-event-bus";

function startedEvent(): OrchestratorEvent {
  return {
    type: "conversation.started",
    tenantId: "tenant-1",
    businessId: "business-1",
    conversationId: "conv-1",
    callId: "call-1",
    at: new Date().toISOString(),
  };
}

describe("InProcessEventBus", () => {
  it("delivers a published event to every subscriber of that type", async () => {
    const bus = new InProcessEventBus(createNoopLogger());
    const received: OrchestratorEvent[] = [];
    bus.subscribe("conversation.started", (event) => {
      received.push(event);
    });
    bus.subscribe("conversation.started", (event) => {
      received.push(event);
    });

    await bus.publish(startedEvent());

    expect(received).toHaveLength(2);
  });

  it("does not deliver an event to subscribers of a different type", async () => {
    const bus = new InProcessEventBus(createNoopLogger());
    const received: OrchestratorEvent[] = [];
    bus.subscribe("conversation.ended", (event) => {
      received.push(event);
    });

    await bus.publish(startedEvent());

    expect(received).toHaveLength(0);
  });

  it("a throwing subscriber never breaks the publisher or other subscribers", async () => {
    const bus = new InProcessEventBus(createNoopLogger());
    const received: OrchestratorEvent[] = [];
    bus.subscribe("conversation.started", () => {
      throw new Error("analytics observer blew up");
    });
    bus.subscribe("conversation.started", (event) => {
      received.push(event);
    });

    await expect(bus.publish(startedEvent())).resolves.toBeUndefined();
    expect(received).toHaveLength(1);
  });

  it("publishing with no subscribers is a no-op, not an error", async () => {
    const bus = new InProcessEventBus(createNoopLogger());

    await expect(bus.publish(startedEvent())).resolves.toBeUndefined();
  });
});
