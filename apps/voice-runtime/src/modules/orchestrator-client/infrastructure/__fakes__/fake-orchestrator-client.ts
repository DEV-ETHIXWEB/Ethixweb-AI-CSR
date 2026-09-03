import { randomUUID } from "node:crypto";
import {
  OrchestratorCapacityExceededError,
  OrchestratorConflictError,
  OrchestratorHttpError,
  type ConversationResponse,
  type EndConversationRequest,
  type HandleTurnRequest,
  type InterruptRequest,
  type OrchestratorClientPort,
  type StartConversationRequest,
  type TurnResult,
} from "../../domain/orchestrator-client.port";

/**
 * Hand-written scriptable fake — this codebase's convention (no jest mocks
 * for ports, see apps/voice-orchestrator's own __fakes__ directories).
 * Records every call for assertions and lets a test queue exactly the
 * responses/errors it needs per scenario (normal turn, timeout, capacity
 * rejection, conflict, etc. — see call-session use case specs and the
 * local call simulator).
 */
export class FakeOrchestratorClient implements OrchestratorClientPort {
  readonly startCalls: StartConversationRequest[] = [];
  readonly turnCalls: Array<{ conversationId: string; req: HandleTurnRequest }> = [];
  readonly interruptCalls: Array<{ conversationId: string; req: InterruptRequest }> = [];
  readonly endCalls: Array<{ conversationId: string; req: EndConversationRequest }> = [];

  /** Queue of responses returned by startConversation, consumed FIFO. Defaults to a fresh conversation if empty. */
  startResponses: Array<ConversationResponse | Error> = [];
  /** Queue of responses returned by handleTurn, consumed FIFO. Defaults to a canned "ok" reply if empty. */
  turnResponses: Array<TurnResult | Error> = [];
  interruptResponses: Array<ConversationResponse | Error> = [];
  endResponses: Array<ConversationResponse | Error> = [];
  /** When set, handleTurn hangs until the signal aborts, then rejects with an AbortError — simulates an in-flight turn a caller barges into. */
  hangTurnUntilAborted = false;
  /**
   * Consumed FIFO in lockstep with `turnResponses` — when the entry at
   * the same index is defined, `onChunk` fires once per string here, IN
   * ORDER, instead of the default single call with the whole
   * `responseText`. Mirrors the real server emitting one
   * `{type:"chunk"}` line per LLM completion iteration (docs/28 §C.3) —
   * lets a test exercise genuinely multi-chunk progressive speaking
   * (e.g. a barge-in landing BETWEEN two chunks of the same turn)
   * without needing a real multi-iteration tool-call script. Leave
   * undefined (the default, via a sparse/short array) for the common
   * case of "one chunk, the whole response."
   */
  turnResponseChunks: Array<string[] | undefined> = [];

  async startConversation(req: StartConversationRequest): Promise<ConversationResponse> {
    this.startCalls.push(req);
    const next = this.startResponses.shift();
    if (next instanceof Error) throw next;
    return (
      next ?? {
        id: randomUUID(),
        tenantId: req.tenantId,
        businessId: req.businessId,
        callId: req.callId,
        state: "greeting",
        llmModel: "gpt-4o",
        leadId: null,
        turnCount: 0,
        startedAt: new Date().toISOString(),
        endedAt: null,
        endReason: null,
        greeting: "Thanks for calling, how can I help?",
      }
    );
  }

  async handleTurn(
    conversationId: string,
    req: HandleTurnRequest,
    signal?: AbortSignal,
    onChunk?: (text: string) => void | Promise<void>,
  ): Promise<TurnResult> {
    this.turnCalls.push({ conversationId, req });

    if (this.hangTurnUntilAborted) {
      return new Promise<TurnResult>((_resolve, reject) => {
        signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    }

    const next = this.turnResponses.shift();
    const chunks = this.turnResponseChunks.shift();
    if (next instanceof Error) throw next;
    const result: TurnResult = next ?? {
      conversationId,
      responseText: "Got it, thanks.",
      toolCallsExecuted: [],
      interrupted: false,
      state: "qualifying",
    };
    if (chunks) {
      for (const chunk of chunks) {
        await onChunk?.(chunk);
      }
    } else if (result.responseText) {
      await onChunk?.(result.responseText);
    }
    return result;
  }

  async interrupt(conversationId: string, req: InterruptRequest): Promise<ConversationResponse> {
    this.interruptCalls.push({ conversationId, req });
    const next = this.interruptResponses.shift();
    if (next instanceof Error) throw next;
    return (
      next ?? {
        id: conversationId,
        tenantId: req.tenantId,
        businessId: "business-1",
        callId: "call-1",
        state: "silence",
        llmModel: "gpt-4o",
        leadId: null,
        turnCount: 1,
        startedAt: new Date().toISOString(),
        endedAt: null,
        endReason: null,
      }
    );
  }

  async endConversation(
    conversationId: string,
    req: EndConversationRequest,
  ): Promise<ConversationResponse> {
    this.endCalls.push({ conversationId, req });
    const next = this.endResponses.shift();
    if (next instanceof Error) throw next;
    return (
      next ?? {
        id: conversationId,
        tenantId: req.tenantId,
        businessId: "business-1",
        callId: "call-1",
        state: "ended",
        llmModel: "gpt-4o",
        leadId: null,
        turnCount: 1,
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        endReason: req.endReason,
      }
    );
  }
}

export { OrchestratorCapacityExceededError, OrchestratorConflictError, OrchestratorHttpError };
