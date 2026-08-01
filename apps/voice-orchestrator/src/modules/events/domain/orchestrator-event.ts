/**
 * The orchestrator's own event vocabulary. Deliberately an IN-PROCESS bus,
 * not the transactional outbox apps/core-api uses: the outbox pattern
 * exists to make a DB write and an event publish atomic (docs/01 §5), and
 * this service has no database to be atomic with. These events are for
 * in-process observers (logging, metrics, the future analytics/notification
 * consumers) — anything requiring durable, exactly-once delivery belongs in
 * core-api's outbox instead, written by the tool handlers that already call
 * it (e.g. `lead.created` is published there by CreateLeadUseCase, NOT
 * re-published here).
 */
export type OrchestratorEvent =
  | {
      type: "conversation.started";
      tenantId: string;
      businessId: string;
      conversationId: string;
      callId: string;
      at: string;
    }
  | {
      type: "turn.started";
      tenantId: string;
      conversationId: string;
      turnIndex: number;
      at: string;
    }
  | {
      type: "turn.finished";
      tenantId: string;
      conversationId: string;
      turnIndex: number;
      durationMs: number;
      at: string;
    }
  | { type: "tool.called"; tenantId: string; conversationId: string; toolName: string; at: string }
  | {
      type: "tool.completed";
      tenantId: string;
      conversationId: string;
      toolName: string;
      status: "success" | "degraded";
      durationMs: number;
      at: string;
    }
  | { type: "lead.created"; tenantId: string; conversationId: string; leadId: string; at: string }
  | {
      type: "escalation.triggered";
      tenantId: string;
      conversationId: string;
      severity: string;
      action: string;
      at: string;
    }
  | {
      type: "conversation.ended";
      tenantId: string;
      conversationId: string;
      endReason: string;
      at: string;
    };

export type OrchestratorEventType = OrchestratorEvent["type"];

export type OrchestratorEventHandler = (event: OrchestratorEvent) => void | Promise<void>;

export const EVENT_BUS = Symbol("EVENT_BUS");

export interface EventBusPort {
  publish(event: OrchestratorEvent): Promise<void>;
  subscribe(type: OrchestratorEventType, handler: OrchestratorEventHandler): void;
}
