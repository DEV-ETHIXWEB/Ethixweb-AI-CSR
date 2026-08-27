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
   */
  escalation?: { severity: string; action: string };
}

/** Bounds a pathological model tool-loop. Not a documented constant — an INFERRED safety limit; a real call needs at most a handful (searchCustomer → escalateEmergency → createLead). */
const MAX_TOOL_ITERATIONS = 5;

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
    conversation.messages.push({ role: "user", content: command.transcript });

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
    let escalation: { severity: string; action: string } | undefined;

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

    await this.repository.save(conversation);

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

  private async streamOneCompletion(
    conversation: Conversation,
    tools: Array<{ name: string; description: string; parameters: Record<string, unknown> }>,
    signal: AbortSignal | undefined,
  ): Promise<{ text: string; toolCalls: AiToolCallRequest[]; interrupted: boolean }> {
    let text = "";
    const toolCalls: AiToolCallRequest[] = [];
    let interrupted = false;

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
  ): Promise<{ output: unknown; escalation?: { severity: string; action: string } }> {
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
  ): Promise<{ severity: string; action: string } | undefined> {
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
      await this.eventBus.publish({
        type: "escalation.triggered",
        tenantId: conversation.tenantId,
        conversationId: conversation.id,
        severity,
        action,
        at: new Date().toISOString(),
      });
      return { severity, action };
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
