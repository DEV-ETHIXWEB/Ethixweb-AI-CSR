import { randomUUID } from "node:crypto";
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
import { ProviderCompletionError } from "../../ai-provider/domain/errors";
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

/**
 * `admitTurn()`'s result — see that method's own comment for why this
 * exists as a distinct two-phase step rather than folded into
 * `execute()` directly. `"cached"` means an idempotent replay already
 * fully resolved the turn with no LLM call; `"live"` hands back a `run`
 * continuation the caller invokes once it's actually ready to commit to
 * a response (streaming or otherwise).
 */
export type TurnAdmission =
  | { kind: "cached"; result: HandleTurnResult }
  | { kind: "live"; run: (onChunk?: (text: string) => void) => Promise<HandleTurnResult> };

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

  /**
   * `onChunk`, when supplied, fires once per natural speech segment
   * (see `findSpeechSegmentBoundary`) as text streams in from the
   * provider — potentially several times within a single LLM
   * completion, not just once per tool-loop iteration — with exactly
   * the NEW text that segment contains (never the cumulative total —
   * the caller decides how to join what it's already spoken with
   * what's new). Purely additive: every existing caller that omits it
   * gets byte-for-byte the same behavior as before this existed — the
   * return value is always the complete aggregate result regardless of
   * whether a callback was given.
   *
   * This exists because of a real, MEASURED finding, not a guess: a real
   * call's first LLM completion produced real acknowledgment text
   * alongside its tool calls, and that text sat unused for the full
   * duration of the tool round-trip and the second completion (over a
   * second of dead air) purely because the old contract only ever
   * returned text once the ENTIRE turn — every completion, every tool
   * call — had finished. The FIRST version of this fix only flushed once
   * per tool-loop iteration, which closed that specific gap but did
   * nothing for the far more common case of a turn with NO tool call at
   * all (a single iteration) — there, one flush per iteration means one
   * flush after the ENTIRE completion already finished generating
   * server-side, no earlier than before streaming existed.
   * `streamOneCompletion`'s own sentence-boundary flushing is what
   * actually fixes that common case too.
   *
   * On an idempotent REPLAY (a Voice Runtime retry of an already-
   * completed turn), `onChunk` still fires exactly once, with the full
   * cached `responseText` — the caller's contract ("I get chunks, then
   * a final result") stays identical whether this attempt actually ran
   * the LLM or not.
   */
  async execute(
    command: HandleTurnCommand,
    onChunk?: (text: string) => void,
  ): Promise<HandleTurnResult> {
    const admission = await this.admitTurn(command);
    if (admission.kind === "cached") {
      if (admission.result.responseText) {
        onChunk?.(admission.result.responseText);
      }
      return admission.result;
    }
    return admission.run(onChunk);
  }

  /**
   * Split out of `execute()` specifically so a streaming HTTP layer (the
   * controller) can do the pre-flight checks below — conversation
   * lookup, ended check, idempotency begin/in-flight — and let a
   * genuine failure there (`ConversationNotFoundError`,
   * `ConversationAlreadyEndedError`, `TurnAlreadyInFlightError`)
   * propagate as an ordinary thrown error BEFORE committing to writing
   * any response body. Once a streaming response has started (status
   * code + headers sent), HTTP fundamentally cannot change the status
   * code anymore — so these specific checks, which the existing 404/409
   * exception-filter behavior depends on, have to fully resolve first,
   * strictly before the caller writes anything. Only once this returns
   * a `"live"` admission is it actually safe to commit to a 200 and
   * start streaming; a `"cached"` admission (idempotent replay) never
   * touches the LLM at all, so there's nothing to stream — the full
   * result is already known.
   *
   * `execute()` above is unchanged in every observable way for every
   * existing caller — it's now a thin, fully backward-compatible
   * wrapper over this and `run()`.
   */
  async admitTurn(command: HandleTurnCommand): Promise<TurnAdmission> {
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
      return { kind: "cached", result: outcome.result };
    }
    if (outcome.status === "in_flight") {
      throw new TurnAlreadyInFlightError(idempotencyKey);
    }

    return {
      kind: "live",
      run: async (onChunk?: (text: string) => void) => {
        try {
          const result = await this.runTurn(command, conversation, onChunk);
          await this.idempotencyStore.complete(idempotencyKey, result, { ttlSeconds: 3600 });
          return result;
        } catch (error) {
          // Release so a legitimate retry with the SAME key isn't
          // permanently blocked behind a reservation nothing will ever
          // complete. Safe to surface as a mid-stream error event (not
          // an HTTP status change) — by the time `run()` is even
          // reachable, the caller has already committed to a 200 and
          // started streaming.
          await this.idempotencyStore.release(idempotencyKey);
          throw error;
        }
      },
    };
  }

  private async runTurn(
    command: HandleTurnCommand,
    conversation: Conversation,
    onChunk?: (text: string) => void,
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

    // Voice-pipeline latency investigation (real live reports of 30-40s+
    // perceived response time): this loop can run the LLM completion
    // MULTIPLE sequential times per single caller turn (a tool call, or
    // the escalateEmergency backstop, each forces one more full
    // round-trip before responseText is complete) — and NONE of that was
    // previously visible anywhere. voice-runtime only ever sees this
    // method's SINGLE final HTTP response; nothing here recorded how many
    // completions ran or how long each took. `iterationCount` is
    // deliberately tracked here (not just inferred from log line count)
    // so the "turn HTTP round-trip completed" log below states the exact
    // number regardless of how the loop exits.
    let iterationCount = 0;

    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
      iterationCount += 1;
      conversation.messages = compressMessages(conversation.messages);

      const turn = await this.streamOneCompletion(
        conversation,
        tools,
        command.signal,
        iteration,
        onChunk,
      );
      responseText = appendResponseSegment(responseText, turn.text);
      interrupted = turn.interrupted;
      // Sub-segment flushing (natural sentence/clause boundaries) already
      // happened INSIDE streamOneCompletion as this iteration's own text
      // streamed in — see that method's own comment. Nothing left to
      // flush here; calling onChunk again with `turn.text` would re-speak
      // this whole iteration's text a second time.

      // Deterministic safety nets, docs/07 §5.2's "fail-safe toward
      // escalation" now enforced in code, not only prompted. Found live:
      // running the SAME unambiguous emergency description 10 times
      // against the real model, with the prompt already telling it to
      // ALWAYS call escalateEmergency (never conditionally), still missed
      // the call entirely on 1 run — LLM sampling variance has a ceiling
      // no prompt wording alone can close. If the model is about to end
      // its turn/iteration with no tool calls of its own, substitute
      // synthetic call(s) for whichever guaranteed tool(s) this call has
      // never actually checked — the SAME tool, SAME orchestrator-executed
      // side effect a real model call would produce, just guaranteed. The
      // loop then runs one more completion exactly as it would for any
      // other tool call, so the model still reacts and narrates naturally
      // rather than the call going silent. Each backstop fires at most
      // once per conversation (a real model call short-circuits it on any
      // later turn/iteration) — this targets the observed failure (the
      // model finishes having never checked at all), not every
      // conceivable multi-turn shape. Both can fire in the SAME iteration
      // when both are outstanding (the common case: turn 1, plain
      // greeting-response text, no tool calls at all).
      //
      // searchCustomer's backstop: found live on a real ~7-minute call —
      // a valid caller ANI was present the entire time, the tool's own
      // description calls it "First tool called on every inbound call,"
      // and the platform prompt says the same, yet the model never called
      // it once in 17 turns. Only fires when `conversation.callerAni` is
      // actually set — there's nothing to search with otherwise, and that
      // case is a real caller-ID-unavailable scenario, not a bug this
      // backstop should paper over.
      let toolCalls = turn.toolCalls;
      if (!turn.interrupted && turn.toolCalls.length === 0) {
        const backstops: AiToolCallRequest[] = [];
        if (
          command.allowedTools.includes("searchCustomer") &&
          conversation.callerAni &&
          !hasCalledSearchCustomer(conversation)
        ) {
          backstops.push(buildSearchCustomerBackstopCall(conversation.callerAni));
        }
        // Found live on a real ~21-minute call: escalateEmergency's
        // once-ever backstop correctly fired on turn 1 (an unrelated
        // "not sure what's going on" transcript), then the caller went on
        // to describe an ACTIVE, HAPPENING-RIGHT-NOW leak from what they
        // called a "burst pipe" almost 20 minutes later — real content
        // that DEFAULT_EMERGENCY_KEYWORDS' own "burst pipe" pattern would
        // classify as critical/forward_call — and the tool was never
        // called again for it. Grace's own TEXT response correctly gave
        // emergency safety instructions (shut off the valve), but the
        // actual escalation infrastructure (business-configured rules,
        // on-call transfer, createLead's priority field) never ran,
        // because `hasCalledEscalateEmergency`'s "ever" gate suppressed a
        // second, legitimately new check. `looksEmergencyAdjacent` is a
        // deliberately liberal, LOCAL heuristic — never the actual
        // classification (core-api's real classify() still owns that
        // entirely) — that exists only to decide whether THIS turn's
        // transcript is worth re-checking regardless of an earlier,
        // unrelated check. Over-triggering costs one harmless extra
        // round-trip; under-triggering is the one this real call proved
        // costs an actual missed emergency.
        if (
          command.allowedTools.includes("escalateEmergency") &&
          (!hasCalledEscalateEmergency(conversation) ||
            (looksEmergencyAdjacent(command.transcript) &&
              conversation.lastEmergencyCheckedTranscript !== command.transcript))
        ) {
          backstops.push(buildEscalationBackstopCall(command.transcript));
        }
        if (backstops.length > 0) {
          toolCalls = backstops;
        }
      }

      if (turn.text || toolCalls.length > 0) {
        conversation.messages.push({
          role: "assistant",
          content: turn.text,
          ...(toolCalls.length > 0 ? { toolCalls } : {}),
        });
      }

      if (turn.interrupted || toolCalls.length === 0) {
        break;
      }

      for (const toolCall of toolCalls) {
        toolCallsExecuted.push(toolCall.name);
        if (toolCall.name === "escalateEmergency") {
          conversation.emergencyEverChecked = true;
          conversation.lastEmergencyCheckedTranscript = command.transcript;
        }
        if (toolCall.name === "searchCustomer") {
          conversation.searchCustomerEverChecked = true;
        }
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
    // Voice-pipeline latency investigation — the ONE number that tells
    // voice-runtime's own "turn HTTP round-trip completed" log (which
    // measures the SAME turn from the outside, across the network hop)
    // whether time was spent HERE (LLM completions + tool calls) or lost
    // somewhere between the two processes. Correlate by conversationId.
    this.logger.info("turn processing completed", {
      tenantId: conversation.tenantId,
      conversationId: conversation.id,
      durationMs,
      llmCompletions: iterationCount,
      toolCallsExecuted,
      responseLength: responseText.length,
    });
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

  /**
   * `onChunk`, when supplied, fires potentially SEVERAL times during this
   * one completion — at natural speech boundaries (see
   * `findSpeechSegmentBoundary`) as text streams in from the provider,
   * not just once at the end. This is the actual "does the caller hear
   * the first safe chunk before the entire LLM turn finishes" fix: the
   * `onChunk` plumbing added earlier (see `execute()`'s own comment)
   * only ever flushed once per LOOP ITERATION in `runTurn` — for the
   * overwhelmingly common case of a turn with no tool call (a single
   * iteration), that meant `onChunk` fired exactly once, AFTER the
   * provider had already finished streaming its ENTIRE response
   * server-side, which is no earlier than the old non-streaming
   * contract ever was. Flushing at sentence/clause boundaries as this
   * SINGLE completion's own token stream arrives is what actually lets
   * a caller start hearing speech while the model is still generating
   * the rest of it — the latency win the tool-call-loop case already
   * had, extended to the plain-Q&A case, which is the majority of real
   * turns.
   */
  private async streamOneCompletion(
    conversation: Conversation,
    tools: Array<{ name: string; description: string; parameters: Record<string, unknown> }>,
    signal: AbortSignal | undefined,
    iteration: number,
    onChunk?: (text: string) => void,
  ): Promise<{ text: string; toolCalls: AiToolCallRequest[]; interrupted: boolean }> {
    let text = "";
    // Text accumulated since the last onChunk flush — NOT yet spoken.
    // Deliberately separate from `text` (the full running total this
    // method returns): a natural speech boundary is found relative to
    // "what hasn't been sent yet," not the whole completion so far.
    let pendingSegment = "";
    const toolCalls: AiToolCallRequest[] = [];
    let interrupted = false;
    let providerErrorMessage: string | null = null;
    let providerErrorRetryable = true;
    // Voice-pipeline latency investigation — isolates provider-network
    // latency (time to the FIRST chunk, unavoidable no matter how this
    // codebase's own code changes) from total generation time (grows
    // with response length, and IS something prompt/response-length
    // choices affect).
    const startedAt = Date.now();
    let firstChunkAt: number | null = null;

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
        if (firstChunkAt === null) {
          firstChunkAt = Date.now();
        }
        if (signal?.aborted) {
          interrupted = true;
          break;
        }
        if (chunk.type === "error") {
          providerErrorMessage = chunk.message;
          providerErrorRetryable = chunk.retryable;
        }
        const handled = this.applyChunk(chunk, toolCalls);
        text += handled.text;
        pendingSegment += handled.text;
        if (handled.text) {
          const boundary = findSpeechSegmentBoundary(pendingSegment);
          if (boundary !== null) {
            const segment = pendingSegment.slice(0, boundary);
            pendingSegment = pendingSegment.slice(boundary);
            if (segment.trim()) {
              onChunk?.(segment);
            }
          }
        }
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
        // FOUND LIVE via a QA failure-injection pass, not from a real
        // call report: a genuinely THROWN exception from the provider's
        // own generator (every adapter's raw JSON.parse on an SSE
        // payload can throw this on a malformed vendor response — a
        // hand-crafted malformed data: line reproduces it directly from
        // anthropic.adapter.ts) never set providerErrorMessage, only the
        // well-formed `{type:"error"}` chunk path did. With zero text
        // produced before the throw, that meant this method returned an
        // ordinary-looking SUCCESSFUL `{text: "", toolCalls: [],
        // interrupted: false}` — the EXACT silent-dead-air shape
        // documented below (search "FallbackAiProvider") as already
        // fixed for the error-CHUNK case, just never extended to cover
        // a genuine throw. `retryable: true` by default here: an
        // unclassified exception is exactly the "ambiguous outcome, safe
        // to retry" case docs/28 §G already covers, the same default
        // ProviderCompletionError itself falls back to.
        providerErrorMessage = error instanceof Error ? error.message : String(error);
      }
    }

    // Whatever's left never hit a natural boundary on its own (a short
    // complete reply like "Got it." — the common case — or the tail end
    // of a longer one) — flush it now rather than losing it. Matches
    // the pre-existing contract of "whatever was captured gets returned/
    // spoken," interrupted or not (see this class's own top-level
    // comment on barge-in).
    if (pendingSegment.trim()) {
      onChunk?.(pendingSegment);
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
    //
    // ProviderCompletionError (not a plain Error): carries the adapter's own
    // retryable classification (AiProviderHttpError.isRetryable) all the way
    // to ConversationsController's `{type:"error"}` line — found live that a
    // genuinely PERMANENT failure (a request-shape bug, not a transient
    // network blip) was still costing the caller a wasted retry-then-fail
    // cycle because this classification was computed correctly by the
    // adapter and then discarded here, forcing every failure to look
    // retryable regardless of cause. See ProviderCompletionError's own
    // comment for the real cost this measured.
    if (providerErrorMessage !== null && !interrupted && !text && toolCalls.length === 0) {
      throw new ProviderCompletionError(providerErrorMessage, providerErrorRetryable);
    }

    this.logger.info("LLM completion finished", {
      tenantId: conversation.tenantId,
      conversationId: conversation.id,
      iteration,
      timeToFirstChunkMs: firstChunkAt === null ? null : firstChunkAt - startedAt,
      totalMs: Date.now() - startedAt,
      textLength: text.length,
      toolCallCount: toolCalls.length,
      toolCallNames: toolCalls.map((call) => call.name),
      interrupted,
    });

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
      // Voice-pipeline latency investigation — the event above has no
      // subscriber that logs it anywhere (InProcessEventBus only logs a
      // handler THROWING, never the event itself), so tool-call duration
      // was invisible in practice despite being computed.
      this.logger.info("tool call finished", {
        tenantId: conversation.tenantId,
        conversationId: conversation.id,
        toolName: toolCall.name,
        status: result.status,
        durationMs: result.durationMs,
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
 * Regression fix for a real bug found live: `responseText += turn.text`
 * across tool-loop iterations glued text segments together with no
 * separator — "pulling up your account.I'm having a quick technical
 * hiccup" — because each iteration's text is the model's own complete
 * sentence(s) for that point in the loop (a natural pause for a tool
 * call happened in between), not a raw token continuing mid-word. A
 * single space, the same pause a person takes between sentences,
 * joins them correctly; `trimEnd`/`trimStart` avoid a double space if
 * either side already carries trailing/leading whitespace.
 */
function appendResponseSegment(existing: string, next: string): string {
  if (!next) return existing;
  if (!existing) return next;
  return `${existing.trimEnd()} ${next.trimStart()}`;
}

/**
 * Below this length, `streamOneCompletion` never proactively flushes a
 * segment even at a real sentence boundary — bundles a short "Okay."
 * with whatever comes right after it into one spoken unit instead of a
 * standalone one-word TTS call, matching Step 3's own "Okay, I
 * understand. Let me ask you one quick question." example (two short
 * sentences spoken together, not each on its own). INFERRED, not a
 * documented/measured constant — chosen as roughly "a short complete
 * clause," not derived from a benchmark.
 */
const MIN_SPEECH_SEGMENT_CHARS = 40;
/**
 * Above this length with no sentence boundary at all (a long
 * comma-separated clause), flush anyway rather than let latency grow
 * unbounded waiting for punctuation that may never come soon enough —
 * roughly 1-2 natural sentences of CSR dialogue (docs/03 §5's own
 * "1-3 sentences" turn-length guidance), not a measured ceiling.
 */
const MAX_SPEECH_SEGMENT_CHARS = 220;

/**
 * Finds where in `buffer` (text streamed so far but not yet flushed to
 * `onChunk`) a natural speech pause exists, so `streamOneCompletion` can
 * start the caller hearing a real sentence/clause instead of either (a)
 * word-by-word fragments (flushing on every provider delta) or (b)
 * waiting for the entire completion to finish generating (the old
 * per-iteration-only flush). Returns the exclusive end index to flush up
 * to, or `null` if no safe boundary exists yet — the caller should keep
 * accumulating.
 *
 * Sentence-ending punctuation (`.`/`!`/`?`) followed by whitespace or
 * end-of-buffer is the primary boundary, but ONLY once the segment is
 * at least `MIN_SPEECH_SEGMENT_CHARS` long, and never when it looks like
 * a decimal number or a similar digit-adjacent period (`$3.50`, `9 a.m.
 * to 5 p.m.`) — splitting THOSE mid-token would speak two disconnected,
 * confusing fragments instead of the number/time as one unit. Past
 * `MAX_SPEECH_SEGMENT_CHARS` with no sentence boundary at all, falls
 * back to the last comma/semicolon clause break, or the raw ceiling
 * itself if there isn't even one of those — better to speak an
 * unpunctuated run than let latency grow unbounded.
 */
function findSpeechSegmentBoundary(buffer: string): number | null {
  if (buffer.length >= MAX_SPEECH_SEGMENT_CHARS) {
    const window = buffer.slice(0, MAX_SPEECH_SEGMENT_CHARS);
    const lastClause = Math.max(window.lastIndexOf(", "), window.lastIndexOf("; "));
    return lastClause > MIN_SPEECH_SEGMENT_CHARS ? lastClause + 2 : MAX_SPEECH_SEGMENT_CHARS;
  }

  const sentenceEnd = /[.!?]+(?=\s|$)/g;
  let match: RegExpExecArray | null;
  while ((match = sentenceEnd.exec(buffer)) !== null) {
    const endIndex = match.index + match[0].length;
    if (endIndex < MIN_SPEECH_SEGMENT_CHARS) {
      continue;
    }
    const precedingChar = buffer[match.index - 1];
    const followingChar = buffer[endIndex];
    const looksLikeDecimal =
      precedingChar !== undefined &&
      /\d/.test(precedingChar) &&
      followingChar !== undefined &&
      /\d/.test(followingChar);
    if (looksLikeDecimal || looksLikeAbbreviation(buffer, endIndex)) {
      continue;
    }
    return endIndex;
  }
  return null;
}

/**
 * Catches the abbreviation cases a bare "digit before AND after the
 * period" check misses — real ones for a home-service CSR, not
 * hypothetical: "9 a.m. to 5 p.m." is a completely ordinary thing for
 * this domain's own model to say about business hours, and the SECOND
 * period in "a.m." (the one right before "to") IS followed by
 * whitespace, so the base regex alone would treat it as a sentence end
 * and split "9 a.m." from "to 5 p.m." into two disconnected, confusing
 * spoken fragments.
 */
function looksLikeAbbreviation(buffer: string, periodEndIndex: number): boolean {
  // "a.m." / "p.m." / "e.g." / "i.e." / "U.S." — a lone letter, period,
  // lone letter, period pattern ending exactly at this boundary.
  const precedingWindow = buffer.slice(Math.max(0, periodEndIndex - 6), periodEndIndex);
  if (/\b[a-zA-Z]\.[a-zA-Z]\.$/.test(precedingWindow)) {
    return true;
  }
  // A short, common title/abbreviation immediately before a single
  // trailing period ("Dr.", "Mr.", "etc.", ...).
  const wordBeforePeriod = /([a-zA-Z]{1,10})\.$/.exec(buffer.slice(0, periodEndIndex));
  if (!wordBeforePeriod) {
    return false;
  }
  const word = wordBeforePeriod[1]!.toLowerCase();
  return ["mr", "mrs", "ms", "dr", "st", "vs", "etc", "approx", "jr", "sr"].includes(word);
}

/**
 * A real model-issued call and the backstop call below are indistinguishable
 * here, both short-circuit the same way. Checks `emergencyEverChecked` FIRST
 * — the durable signal that survives `compressMessages` dropping old
 * `toolCalls` entries during a long call (see that field's own comment) —
 * falling back to a live message-history scan for a conversation that
 * predates the field (or any path that sets the flag).
 */
function hasCalledEscalateEmergency(conversation: Conversation): boolean {
  if (conversation.emergencyEverChecked === true) {
    return true;
  }
  return conversation.messages.some((message) =>
    message.toolCalls?.some((toolCall) => toolCall.name === "escalateEmergency"),
  );
}

function buildEscalationBackstopCall(transcript: string): AiToolCallRequest {
  return {
    id: randomUUID(),
    name: "escalateEmergency",
    arguments: { description: transcript },
  };
}

/**
 * Deliberately liberal keyword trigger, NOT the real emergency
 * classification (core-api's EscalateEmergencyUseCase.classify — real
 * word-set matching against DEFAULT_EMERGENCY_KEYWORDS plus any
 * business-configured rules — still owns that entirely; this only
 * decides whether THIS caller turn is worth a fresh escalateEmergency
 * call even though an earlier, unrelated turn already checked once this
 * conversation). Built from the same vocabulary as
 * DEFAULT_EMERGENCY_KEYWORDS (burst/pipe, gas, sewer/sewage, flooding,
 * no water, overflowing) since that's the real classifier this is
 * gating a call to — a plain substring check, not word-set matching,
 * because over-triggering here just costs one harmless extra
 * round-trip where classify() correctly says "not an emergency," while
 * under-triggering is the exact failure a real call proved costly: an
 * active leak described as "for that burst pipe... happening right
 * now" almost 20 minutes into a call, after an unrelated turn-1 check
 * had already satisfied the old "ever" gate, was never re-classified at
 * all.
 */
function looksEmergencyAdjacent(transcript: string): boolean {
  const lower = transcript.toLowerCase();
  const triggers = [
    "burst",
    "leak",
    "flood",
    "gas leak",
    "smell gas",
    "smell of gas",
    "sewage",
    "sewer backup",
    "sewer back up",
    "no water",
    "no hot water",
    "overflowing",
    "water everywhere",
  ];
  return triggers.some((trigger) => lower.includes(trigger));
}

/** Same rationale as `hasCalledEscalateEmergency` — checks the durable flag first, falls back to a live message-history scan. */
function hasCalledSearchCustomer(conversation: Conversation): boolean {
  if (conversation.searchCustomerEverChecked === true) {
    return true;
  }
  return conversation.messages.some((message) =>
    message.toolCalls?.some((toolCall) => toolCall.name === "searchCustomer"),
  );
}

function buildSearchCustomerBackstopCall(phone: string): AiToolCallRequest {
  return {
    id: randomUUID(),
    name: "searchCustomer",
    arguments: { phone },
  };
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
