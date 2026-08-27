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
   * Phone numbers to transfer to, in ring order — present only when this
   * turn's `escalateEmergency` tool call returned `action: "forward_call"`.
   * The runtime executes the actual SIP transfer (docs/24 §4's
   * "emergency-transfer SIP handoff" checklist item); this service only
   * surfaces the destination, per docs/02 §4/§0's text-in-text-out boundary.
   */
  transferTargets: string[] | null;
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
    let transferTargets: string[] | null = null;

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
        const toolResult = await this.runTool(conversation, toolCall, command.allowedTools);
        if (
          toolCall.name === "escalateEmergency" &&
          isRecord(toolResult) &&
          toolResult["action"] === "forward_call" &&
          Array.isArray(toolResult["transferTargets"])
        ) {
          transferTargets = toolResult["transferTargets"] as string[];
        }
        conversation.messages.push({
          role: "tool",
          toolCallId: toolCall.id,
          content: JSON.stringify(toolResult),
        });
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
      transferTargets,
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
  ): Promise<unknown> {
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
        await this.reactToToolSuccess(conversation, toolCall.name, result.output);
        return result.output;
      }
      return { error: "tool_unavailable", detail: result.reason };
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
      return { error: "tool_rejected", detail: reason };
    }
  }

  /** Side effects the ORCHESTRATOR owns, not the model (docs/04 §3.8: "the model decides, infrastructure code acts"). */
  private async reactToToolSuccess(
    conversation: Conversation,
    toolName: string,
    output: unknown,
  ): Promise<void> {
    if (toolName === "createLead" && isRecord(output) && typeof output["lead_id"] === "string") {
      conversation.leadId = output["lead_id"];
      await this.eventBus.publish({
        type: "lead.created",
        tenantId: conversation.tenantId,
        conversationId: conversation.id,
        leadId: output["lead_id"],
        at: new Date().toISOString(),
      });
      return;
    }

    if (toolName === "escalateEmergency" && isRecord(output) && output["isEmergency"] === true) {
      await this.eventBus.publish({
        type: "escalation.triggered",
        tenantId: conversation.tenantId,
        conversationId: conversation.id,
        severity: String(output["severity"]),
        action: String(output["action"]),
        at: new Date().toISOString(),
      });
    }
  }

  private appendTranscript(conversation: Conversation, turn: TranscriptTurn): void {
    conversation.transcript.push(turn);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
