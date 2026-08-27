import { randomUUID } from "node:crypto";
import type { StructuredLogger } from "@ethixweb/shared-kernel";
import type { RuntimeConfig } from "./config.js";
import type { OrchestratorClient } from "./orchestrator-client.js";

/**
 * The minimal shape of `@livekit/agents`' `ChatContext` this file actually
 * reads from — deliberately duck-typed rather than importing the SDK's own
 * `ChatContext`/`ChatItem` types here. That keeps `createLlmNode`'s
 * generator testable with plain mock objects (Task #8) instead of
 * constructing real SDK class instances, while still being structurally
 * assignable everywhere `@livekit/agents`' `AgentHooks.llmNode` is expected
 * (verified via `tsc --noEmit` against the real installed SDK types, not
 * assumed).
 */
export interface ChatContextLike {
  items: ReadonlyArray<{
    type: string;
    role?: string | undefined;
    textContent?: string | undefined;
    transcriptConfidence?: number | undefined;
  }>;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function extractLastUserTurn(chatCtx: ChatContextLike): { text: string; confidence?: number } | null {
  for (let index = chatCtx.items.length - 1; index >= 0; index--) {
    const item = chatCtx.items[index];
    if (item?.type === "message" && item.role === "user" && item.textContent) {
      return {
        text: item.textContent,
        ...(item.transcriptConfidence !== undefined
          ? { confidence: item.transcriptConfidence }
          : {}),
      };
    }
  }
  return null;
}

/**
 * Executes the actual SIP transfer once voice-orchestrator's turn result
 * surfaces non-empty `transferTargets` (docs/24 §4's "emergency-transfer
 * SIP handoff" checklist item — this service never places or transfers
 * calls itself, per docs/02 §0's text-in-text-out boundary; the runtime
 * does). Injected so `CallSession`'s turn/barge-in logic stays unit
 * testable without constructing real LiveKit SIP/room internals — same
 * fakes-at-the-port-boundary style as the rest of this codebase.
 */
export type TransferExecutor = (targets: string[]) => Promise<void>;

export interface CallSessionDeps {
  orchestrator: OrchestratorClient;
  config: RuntimeConfig;
  transferExecutor: TransferExecutor;
  logger: StructuredLogger;
}

/**
 * Owns one call's lifecycle against voice-orchestrator's 5-endpoint
 * contract (docs/24-runtime-orchestrator-contract.md). Everything here is
 * text in, text out — no audio, no STT/TTS concepts — which is exactly
 * what lets this runtime swap LiveKit for another voice vendor without
 * touching voice-orchestrator at all (docs/02 §0).
 */
export class CallSession {
  private conversationId: string | undefined;
  private callId: string | undefined;
  private callStartedAt = 0;
  private inFlightAbort: AbortController | undefined;
  private turnInFlight = false;

  constructor(private readonly deps: CallSessionDeps) {}

  async start(callerAni: string, toNumber?: string): Promise<void> {
    this.callId = randomUUID();
    this.callStartedAt = Date.now();
    const conversation = await this.deps.orchestrator.startConversation({
      tenantId: this.deps.config.pilotTenantId,
      businessId: this.deps.config.pilotBusinessId,
      callId: this.callId,
      callerAni,
      ...(toNumber ? { toNumber } : {}),
      timezone: this.deps.config.pilotTimezone,
    });
    this.conversationId = conversation.id;
    this.deps.logger.info("call started", { callId: this.callId, conversationId: conversation.id });
  }

  /**
   * The turn loop, shaped to match `@livekit/agents`' `AgentHooks.llmNode`
   * signature (`(ctx, chatCtx, toolCtx, modelSettings) => AsyncIterable<string>`)
   * so it can be passed directly to `Agent.create({ llmNode: ... })` in
   * agent.ts. `responseText` arrives as one complete string per turn (this
   * service's HTTP contract is request/response, not token-streamed — see
   * docs/24 §2.2), so this yields exactly once per turn rather than
   * simulating sentence-level streaming that doesn't actually exist yet.
   */
  createLlmNode() {
    return async (
      _ctx: unknown,
      chatCtx: ChatContextLike,
      _toolCtx: unknown,
      _modelSettings: unknown,
    ): Promise<AsyncGenerator<string>> => {
      return this.runTurn(chatCtx);
    };
  }

  private async *runTurn(chatCtx: ChatContextLike): AsyncGenerator<string> {
    if (!this.conversationId) {
      throw new Error("CallSession.runTurn called before start()");
    }
    const turn = extractLastUserTurn(chatCtx);
    if (!turn) {
      return;
    }

    // Generated exactly ONCE per turn attempt — docs/24 §2.2's explicit
    // requirement. OrchestratorClient.sendTurn's own retry logic reuses
    // this identical value across any transient retry; a fresh key must
    // never be minted for what might be the same attempt.
    const idempotencyKey = randomUUID();
    const controller = new AbortController();
    this.inFlightAbort = controller;
    this.turnInFlight = true;

    try {
      const result = await this.deps.orchestrator.sendTurn(
        this.conversationId,
        {
          tenantId: this.deps.config.pilotTenantId,
          idempotencyKey,
          transcript: turn.text,
          ...(turn.confidence !== undefined ? { sttConfidence: turn.confidence } : {}),
          offsetMs: Date.now() - this.callStartedAt,
          allowedTools: this.deps.config.pilotAllowedTools,
        },
        controller.signal,
      );

      if (result.responseText) {
        yield result.responseText;
      }

      if (result.transferTargets && result.transferTargets.length > 0) {
        // Fire after the response text is yielded (so the caller hears
        // whatever acknowledgment the model gave — e.g. "Connecting you
        // now" — before the transfer dial begins), but still within this
        // turn: a failed transfer must not silently vanish.
        try {
          await this.deps.transferExecutor(result.transferTargets);
        } catch (error) {
          this.deps.logger.error("emergency transfer failed", {
            callId: this.callId,
            reason: error instanceof Error ? error.message : String(error),
          });
        }
      }
    } catch (error) {
      if (isAbortError(error)) {
        // Mid-turn barge-in (docs/24 §2.3 mechanism 1) — whatever text had
        // already streamed was already handled server-side (HandleTurnUseCase
        // returns `interrupted: true` with the partial text on its own next
        // call); nothing further to yield here.
        return;
      }
      throw error;
    } finally {
      this.turnInFlight = false;
      this.inFlightAbort = undefined;
    }
  }

  /**
   * Barge-in (docs/24 §2.3): call this when VAD detects the caller speaking
   * while TTS is still playing. Two distinct mechanisms, matching the
   * contract exactly — not redundant:
   * mid-turn abort when a turn HTTP call is in flight, or the lighter-weight
   * `/interrupt` signal when TTS is still playing between turns.
   */
  handleBargeIn(): void {
    if (this.turnInFlight && this.inFlightAbort) {
      this.inFlightAbort.abort();
      return;
    }
    if (!this.conversationId) {
      return;
    }
    this.deps.orchestrator
      .interrupt(this.conversationId, this.deps.config.pilotTenantId)
      .catch((error: unknown) => {
        this.deps.logger.warn("interrupt signal failed (non-fatal)", {
          callId: this.callId,
          reason: error instanceof Error ? error.message : String(error),
        });
      });
  }

  async end(reason: string): Promise<void> {
    if (!this.conversationId) {
      return;
    }
    await this.deps.orchestrator.endConversation(
      this.conversationId,
      this.deps.config.pilotTenantId,
      reason,
    );
    this.deps.logger.info("call ended", {
      callId: this.callId,
      conversationId: this.conversationId,
      reason,
    });
  }
}
