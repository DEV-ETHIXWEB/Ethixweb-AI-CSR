import { Inject, Injectable } from "@nestjs/common";
import type { IdempotencyStore, StructuredLogger } from "@ethixweb/shared-kernel";
import { APP_LOGGER } from "../../../shared/observability/app-logger.module";
import { setSpanAttributes } from "../../../shared/observability/tracing";
import { IDEMPOTENCY_STORE } from "../../../shared/idempotency/idempotency-store.token";
import {
  AI_PROVIDER_ROUTER,
  type AiCompletionChunk,
  type AiProviderPort,
  type AiToolCallRequest,
} from "../../ai-provider/domain/ai-provider.port";
import { EVENT_BUS, type EventBusPort } from "../../events/domain/orchestrator-event";
import { ExecuteToolUseCase } from "../../tool-broker/application/execute-tool.use-case";
import { ToolRegistry } from "../../tool-broker/application/tool-registry";
import { compressMessages } from "../domain/context-window";
import type { Conversation, TranscriptTurn } from "../domain/conversation.entity";
import {
  ConversationAlreadyEndedError,
  ConversationNotFoundError,
  TurnAlreadyInFlightError,
} from "../domain/errors";
import {
  CONVERSATION_REPOSITORY,
  type ConversationRepository,
} from "../domain/ports/conversation-repository.port";

export interface HandleTurnCommand {
  tenantId: string;
  conversationId: string;
  /** Client-generated, unique per turn attempt — dedups Voice Runtime retries (docs/04 §2 stage 3's idempotency discipline, applied one layer up). */
  idempotencyKey: string;
  /** The finalized caller utterance from the Voice Runtime's STT. */
  transcript: string;
  sttConfidence?: number | undefined;
  offsetMs?: number | undefined;
  /** Every tool this call's agent config may reach — docs/04 §2 stage 2. */
  allowedTools: readonly string[];
  /** Aborts the in-flight LLM stream on barge-in (docs/03 §6's interruption row). */
  signal?: AbortSignal | undefined;
}

export interface HandleTurnResult {
  conversationId: string;
  /** What the Voice Runtime should speak. Empty if the turn was interrupted before any text was produced. */
  responseText: string;
  toolCallsExecuted: string[];
  interrupted: boolean;
  state: Conversation["state"];
  /**
   * Populated iff `escalateEmergency` succeeded THIS turn (docs/28 §M: "the
   * tool result itself signals this to your runtime"). Previously this was
   * only an internal `escalation.triggered` event with no HTTP-visible
   * counterpart — a real runtime has no event bus to subscribe to, only
   * this response, so `action: "forward_call"` was undetectable over the
   * documented contract. Additive field, absent (not null) on every turn
   * that didn't escalate, to keep existing consumers' shape checks unaffected.
   *
   * `transferDestination`: the real, currently-on-call phone number to
   * transfer to when `action === "forward_call"` (core-api's
   * EscalateEmergencyUseCase resolves it via ResolveOnCallUseCase, see its
   * own comment). Absent/null when the action isn't forward_call, or when
   * no on-call target could be resolved — the Voice Runtime's own
   * static EMERGENCY_TRANSFER_NUMBER/HUMAN_FALLBACK_NUMBER fallback covers
   * that case, so this field degrading to null is a normal, expected
   * outcome, not an error condition.
   */
  escalation?: { severity: string; action: string; transferDestination: string | null };
}

/** Bounds a pathological model tool-loop. Not a documented constant — an INFERRED safety limit; a real call needs at most a handful (searchCustomer → escalateEmergency → createLead). */
const MAX_TOOL_ITERATIONS = 5;

/**
 * Below this Deepgram confidence score, the transcript is flagged to the
 * model as possibly-misheard (see `annotateLowConfidenceTranscript`).
 * INFERRED, not a documented constant — 0.8 is a commonly used STT
 * low-confidence cutoff, not a value this codebase measured. Found live:
 * docs/03 §5 already claims "STT confidence score is available to the LLM
 * as part of the transcript metadata" as if it were already true — it
 * wasn't; `sttConfidence` was captured on the durable transcript record
 * but never once appeared in the actual message sent to the model, so the
 * platform prompt's own conditional spelling rule ("only ... when the
 * transcript is flagged as low-confidence") had no signal to act on.
 */
const LOW_STT_CONFIDENCE_THRESHOLD = 0.8;

/**
 * The Turn Manager (docs/03 §2's "the LLM reasons within a state"): takes
 * one finalized caller utterance, runs the LLM/tool loop until the model
 * produces a final spoken response, and returns that text for the Voice
 * Runtime to synthesize. This service never touches audio, STT, or TTS —
 * it consumes text in and returns text out, which is exactly the boundary
 * that lets the runtime swap between Twilio/LiveKit/Retell/Vapi without
 * any business logic changing.
 *
 * Interruption/barge-in (docs/03 §6): the caller's `signal` aborts the
 * in-flight provider stream. Whatever text was already streamed IS
 * returned rather than discarded — it may already have been spoken to the
 * caller, and the model's next turn needs an accurate record of what it
 * actually said ("never 'as I was saying' or restarting the sentence").
 */
@Injectable()
export class HandleTurnUseCase {
  constructor(
    @Inject(CONVERSATION_REPOSITORY) private readonly repository: ConversationRepository,
    @Inject(AI_PROVIDER_ROUTER) private readonly aiProvider: AiProviderPort,
    private readonly executeTool: ExecuteToolUseCase,
    private readonly toolRegistry: ToolRegistry,
    @Inject(EVENT_BUS) private readonly eventBus: EventBusPort,
    @Inject(IDEMPOTENCY_STORE) private readonly idempotencyStore: IdempotencyStore,
    @Inject(APP_LOGGER) private readonly logger: StructuredLogger,
  ) {}

  async execute(command: HandleTurnCommand): Promise<HandleTurnResult> {
    setSpanAttributes({
      "ethixweb.tenant_id": command.tenantId,
      "ethixweb.conversation_id": command.conversationId,
    });

    const conversation = await this.repository.findById(command.tenantId, command.conversationId);
    if (!conversation) {
      throw new ConversationNotFoundError(command.conversationId);
    }
    if (conversation.endedAt) {
      throw new ConversationAlreadyEndedError(command.conversationId);
    }

    // Turn-level idempotency, one layer above ExecuteToolUseCase's own —
    // dedups a Voice Runtime retry of the WHOLE turn (network blip,
    // at-least-once delivery), not just an individual tool call within it.
    const idempotencyKey = `turn:${command.conversationId}:${command.idempotencyKey}`;
    const outcome = await this.idempotencyStore.begin<HandleTurnResult>(idempotencyKey, {
      ttlSeconds: 3600,
    });
    if (outcome.status === "completed") {
      return outcome.result;
    }
    if (outcome.status === "in_flight") {
      throw new TurnAlreadyInFlightError(idempotencyKey);
    }

    try {
      const result = await this.runTurn(command, conversation);
      await this.idempotencyStore.complete(idempotencyKey, result, { ttlSeconds: 3600 });
      return result;
    } catch (error) {
      // Release so a legitimate retry with the SAME key isn't permanently
      // blocked behind a reservation nothing will ever complete.
      await this.idempotencyStore.release(idempotencyKey);
      throw error;
    }
  }

  private async runTurn(
    command: HandleTurnCommand,
    conversation: Conversation,
  ): Promise<HandleTurnResult> {
    const startedAt = Date.now();
    const turnIndex = conversation.transcript.length;
    await this.eventBus.publish({
      type: "turn.started",
      tenantId: conversation.tenantId,
      conversationId: conversation.id,
      turnIndex,
      at: new Date().toISOString(),
    });

    this.appendTranscript(conversation, {
      turnIndex,
      speaker: "caller",
      text: command.transcript,
      confidence: command.sttConfidence ?? null,
      offsetMs: command.offsetMs ?? 0,
      at: new Date().toISOString(),
    });
    // The DURABLE transcript record above stores the raw, verbatim text —
    // this is a SEPARATE, annotated copy for the model's own eyes only, so
    // the confidence flag never pollutes the actual call record.
    conversation.messages.push({
      role: "user",
      content: annotateLowConfidenceTranscript(command.transcript, command.sttConfidence),
    });

    const tools = this.toolRegistry
      .list()
      .filter((definition) => command.allowedTools.includes(definition.name))
      .map((definition) => ({
        name: definition.name,
        description: definition.description,
        parameters: definition.jsonSchema,
      }));

    let responseText = "";
    const toolCallsExecuted: string[] = [];
    let interrupted = false;
    let escalation:
      { severity: string; action: string; transferDestination: string | null } | undefined;

    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
      conversation.messages = compressMessages(conversation.messages);

      const turn = await this.streamOneCompletion(conversation, tools, command.signal);
      responseText += turn.text;
      interrupted = turn.interrupted;

      if (turn.text || turn.toolCalls.length > 0) {
        conversation.messages.push({
          role: "assistant",
          content: turn.text,
          ...(turn.toolCalls.length > 0 ? { toolCalls: turn.toolCalls } : {}),
        });
      }

      if (turn.interrupted || turn.toolCalls.length === 0) {
        break;
      }

      for (const toolCall of turn.toolCalls) {
        toolCallsExecuted.push(toolCall.name);
        const { output, escalation: toolEscalation } = await this.runTool(
          conversation,
          toolCall,
          command.allowedTools,
        );
        conversation.messages.push({
          role: "tool",
          toolCallId: toolCall.id,
          content: JSON.stringify(output),
        });
        // Last escalation in the turn wins — MAX_TOOL_ITERATIONS bounds a
        // pathological loop, not a realistic multi-escalation turn, but a
        // deterministic rule beats an arbitrary first/last pick left unstated.
        if (toolEscalation) {
          escalation = toolEscalation;
        }
      }
    }

    if (responseText) {
      this.appendTranscript(conversation, {
        turnIndex: conversation.transcript.length,
        speaker: "agent",
        text: responseText,
        confidence: null,
        offsetMs: command.offsetMs ?? 0,
        at: new Date().toISOString(),
      });
    }

    await this.saveTurnResult(conversation);

    const durationMs = Date.now() - startedAt;
    await this.eventBus.publish({
      type: "turn.finished",
      tenantId: conversation.tenantId,
      conversationId: conversation.id,
      turnIndex,
      durationMs,
      at: new Date().toISOString(),
    });

    return {
      conversationId: conversation.id,
      responseText,
      toolCallsExecuted,
      interrupted,
      state: conversation.state,
      ...(escalation ? { escalation } : {}),
    };
  }

  /**
   * `conversation` here already carries this whole turn's mutations
   * (transcript/messages pushes, `leadId`, etc. — all applied in place
   * during `runTurn`), read at a `version` that may now be stale: a turn
   * can run for seconds (LLM streaming, tool calls), long enough for the
   * caller to hang up mid-turn and EndConversationUseCase's `save()` to
   * land first — a real race, not a hypothetical one (see that use case's
   * own `resolveLostRace` comment). If the CAS is lost specifically
   * because the conversation ended in the meantime, this turn's state
   * update is deliberately DISCARDED rather than retried — replaying it
   * on top of the newer version would silently resurrect an ended
   * conversation (clobber `endedAt` back to null), corrupting exactly the
   * state EndConversationUseCase just correctly wrote. The turn's response
   * text was very likely already streamed to the caller before the hangup
   * was processed, so this method still lets that response return to the
   * Voice Runtime — only the Redis-side transcript/message persistence for
   * this turn is lost, not the live conversation the caller already heard.
   * Any other lost-CAS cause (e.g. a concurrent `POST /:id/interrupt`
   * transitioning `state`, or two turns genuinely overlapping) gets a
   * single retry on the freshly-read version, same "one re-read is enough,
   * don't loop for a third writer" discipline used throughout this module —
   * but the retry keeps `fresh.state`, not `conversation`'s own (stale)
   * copy of it: this use case never legitimately owns `state` (only
   * TransitionConversationStateUseCase and EndConversationUseCase do), so
   * blindly replaying `conversation` wholesale would silently clobber
   * whatever the concurrent writer changed it to — the exact same class of
   * silent-corruption bug this whole CAS mechanism exists to prevent, just
   * relocated to a different field.
   */
  private async saveTurnResult(conversation: Conversation): Promise<void> {
    const saved = await this.repository.save(conversation);
    if (saved) {
      return;
    }
    const fresh = await this.repository.findById(conversation.tenantId, conversation.id);
    if (!fresh) {
      return;
    }
    if (fresh.endedAt) {
      this.logger.warn(
        "conversation ended mid-turn — this turn's state update was discarded rather than resurrecting the ended conversation",
        { tenantId: conversation.tenantId, conversationId: conversation.id },
      );
      return;
    }
    const retry: Conversation = { ...conversation, version: fresh.version, state: fresh.state };
    const retrySaved = await this.repository.save(retry);
    if (!retrySaved) {
      this.logger.warn(
        "conversation lost a concurrent-write race twice in a row while saving a turn — this turn's state update was discarded",
        { tenantId: conversation.tenantId, conversationId: conversation.id },
      );
    }
  }

  private async streamOneCompletion(
    conversation: Conversation,
    tools: Array<{ name: string; description: string; parameters: Record<string, unknown> }>,
    signal: AbortSignal | undefined,
  ): Promise<{ text: string; toolCalls: AiToolCallRequest[]; interrupted: boolean }> {
    let text = "";
    const toolCalls: AiToolCallRequest[] = [];
    let interrupted = false;
    let providerErrorMessage: string | null = null;

    const stream = this.aiProvider.streamCompletion(
      {
        model: conversation.llmModel,
        systemPrompt: conversation.systemPrompt,
        messages: conversation.messages,
        ...(tools.length > 0 ? { tools } : {}),
      },
      signal,
    );

    try {
      for await (const chunk of stream) {
        if (signal?.aborted) {
          interrupted = true;
          break;
        }
        if (chunk.type === "error") {
          providerErrorMessage = chunk.message;
        }
        const handled = this.applyChunk(chunk, toolCalls);
        text += handled.text;
        if (handled.stop) {
          break;
        }
      }
    } catch (error) {
      // An aborted stream throws from the underlying fetch — that's the
      // expected barge-in path (docs/03 §6), not an error worth failing
      // the turn over. Anything else is logged and degraded, never
      // crashes the live call.
      if (signal?.aborted) {
        interrupted = true;
      } else {
        this.logger.warn("AI provider stream failed mid-turn", {
          tenantId: conversation.tenantId,
          conversationId: conversation.id,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Found live, not hypothetical: with every LLM provider unavailable
    // (unconfigured, or all down), FallbackAiProvider.streamCompletion
    // yields a single `{type: "error"}` chunk and nothing else —
    // applyChunk logs it and stops, but previously this method still
    // returned `{text: "", toolCalls: [], interrupted: false}`, an
    // ordinary-looking SUCCESSFUL result with nothing wrong flagged. That
    // flowed straight through runTurn into a 200 HandleTurnResult with
    // responseText: "" and interrupted: false, which the Voice Runtime's
    // `if (turnResult.responseText) { speak(...) }` treats as "nothing to
    // say" rather than a failure — the caller was left in silent dead air
    // indefinitely, with no apology, no retry, nothing. Thrown here
    // instead (only when the provider layer reported an error AND nothing
    // usable came out of it — real partial text/tool-calls before a
    // mid-stream error are preserved and returned as-is, matching
    // FallbackAiProvider's own "a failure after the first chunk is
    // surfaced as-is" contract) so it propagates as an ordinary 500 the
    // Voice Runtime's EXISTING, already-tested turn-retry-then-apologize
    // logic already handles correctly — not a new failure mode, routing a
    // previously-silent one through infrastructure that already exists.
    if (providerErrorMessage !== null && !interrupted && !text && toolCalls.length === 0) {
      throw new Error(`AI provider completion failed: ${providerErrorMessage}`);
    }

    return { text, toolCalls, interrupted };
  }

  private applyChunk(
    chunk: AiCompletionChunk,
    toolCalls: AiToolCallRequest[],
  ): { text: string; stop: boolean } {
    if (chunk.type === "text_delta") {
      return { text: chunk.text, stop: false };
    }
    if (chunk.type === "tool_call") {
      toolCalls.push(chunk.toolCall);
      return { text: "", stop: false };
    }
    if (chunk.type === "error") {
      this.logger.warn("AI provider returned an error chunk", { reason: chunk.message });
      return { text: "", stop: true };
    }
    return { text: "", stop: true };
  }

  private async runTool(
    conversation: Conversation,
    toolCall: AiToolCallRequest,
    allowedTools: readonly string[],
  ): Promise<{
    output: unknown;
    escalation?: { severity: string; action: string; transferDestination: string | null };
  }> {
    const at = new Date().toISOString();
    await this.eventBus.publish({
      type: "tool.called",
      tenantId: conversation.tenantId,
      conversationId: conversation.id,
      toolName: toolCall.name,
      at,
    });

    try {
      const result = await this.executeTool.execute({
        tenantId: conversation.tenantId,
        businessId: conversation.businessId,
        callId: conversation.callId,
        toolName: toolCall.name,
        arguments: toolCall.arguments,
        allowedTools,
      });

      await this.eventBus.publish({
        type: "tool.completed",
        tenantId: conversation.tenantId,
        conversationId: conversation.id,
        toolName: toolCall.name,
        status: result.status,
        durationMs: result.durationMs,
        at: new Date().toISOString(),
      });

      if (result.status === "success") {
        const escalation = await this.reactToToolSuccess(
          conversation,
          toolCall.name,
          result.output,
        );
        return { output: result.output, ...(escalation ? { escalation } : {}) };
      }
      return { output: { error: "tool_unavailable", detail: result.reason } };
    } catch (error) {
      // A rejected tool (unknown/unauthorized/invalid args) is returned to
      // the MODEL as a structured error rather than thrown — docs/04 §2:
      // "Structured error back to LLM: does NOT execute, does NOT retry
      // silently." Throwing here would kill a live phone call over a
      // model mistake the model can recover from itself.
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn("tool call rejected", {
        tenantId: conversation.tenantId,
        toolName: toolCall.name,
        reason,
      });
      return { output: { error: "tool_rejected", detail: reason } };
    }
  }

  /**
   * Side effects the ORCHESTRATOR owns, not the model (docs/04 §3.8: "the
   * model decides, infrastructure code acts"). Returns the escalation
   * signal (rather than only publishing the internal `escalation.triggered`
   * event) so `runTool`/`runTurn` can additionally surface it on the HTTP
   * response — docs/28 §M's "the tool result itself signals this to your
   * runtime" has no other channel a real, out-of-process Voice Runtime can
   * observe.
   */
  private async reactToToolSuccess(
    conversation: Conversation,
    toolName: string,
    output: unknown,
  ): Promise<{ severity: string; action: string; transferDestination: string | null } | undefined> {
    if (toolName === "createLead" && isRecord(output) && typeof output["lead_id"] === "string") {
      conversation.leadId = output["lead_id"];
      await this.eventBus.publish({
        type: "lead.created",
        tenantId: conversation.tenantId,
        conversationId: conversation.id,
        leadId: output["lead_id"],
        at: new Date().toISOString(),
      });
      return undefined;
    }

    if (toolName === "escalateEmergency" && isRecord(output) && output["isEmergency"] === true) {
      const severity = String(output["severity"]);
      const action = String(output["action"]);
      const transferDestination =
        typeof output["transferDestination"] === "string" ? output["transferDestination"] : null;
      await this.eventBus.publish({
        type: "escalation.triggered",
        tenantId: conversation.tenantId,
        conversationId: conversation.id,
        severity,
        action,
        at: new Date().toISOString(),
      });
      return { severity, action, transferDestination };
    }

    return undefined;
  }

  private appendTranscript(conversation: Conversation, turn: TranscriptTurn): void {
    conversation.transcript.push(turn);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Translated into a plain-language note, not a raw float — an LLM reasons
 * about "this may have been misheard" far more reliably than about
 * whether 0.62 clears an arbitrary numeric threshold it has to infer the
 * meaning of. `undefined` (STT provider didn't report a score) is treated
 * as normal-confidence, not low — silence about confidence is not
 * evidence of low confidence, and flagging every unscored turn would
 * blunt the signal into noise the model learns to ignore.
 */
function annotateLowConfidenceTranscript(
  transcript: string,
  sttConfidence: number | undefined,
): string {
  if (sttConfidence === undefined || sttConfidence >= LOW_STT_CONFIDENCE_THRESHOLD) {
    return transcript;
  }
  return (
    "[speech-to-text confidence was low for this — some words, especially " +
    `names, may be misheard] ${transcript}`
  );
}
