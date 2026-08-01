import type {
  AiCompletionChunk,
  AiCompletionRequest,
  AiMessage,
  AiProviderPort,
  AiToolDefinition,
} from "../domain/ai-provider.port";
import { AiProviderHttpError } from "../domain/errors";
import { readSseEvents } from "./sse-stream.util";

const DEFAULT_BASE_URL = "https://api.anthropic.com/v1";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MAX_TOKENS = 1024;

interface ActiveBlock {
  type: "text" | "tool_use";
  toolUseId: string | undefined;
  toolUseName: string | undefined;
  jsonBuffer: string;
}

/**
 * Anthropic Messages API streaming adapter.
 *
 * UNVERIFIED AGAINST A LIVE SANDBOX — same epistemic-honesty caveat as
 * OpenAiAdapter's own comment. Anthropic's streaming protocol is
 * event-typed (`content_block_start`/`content_block_delta`/
 * `content_block_stop`/`message_delta`), materially different in shape
 * from OpenAI's, mapped here to the same provider-agnostic
 * {@link AiCompletionChunk} union so callers never see the difference.
 */
export class AnthropicAdapter implements AiProviderPort {
  readonly providerName = "anthropic";

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string = DEFAULT_BASE_URL,
  ) {}

  async *streamCompletion(
    request: AiCompletionRequest,
    signal?: AbortSignal,
  ): AsyncIterable<AiCompletionChunk> {
    const response = await fetch(`${this.baseUrl}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: request.model,
        stream: true,
        max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
        temperature: request.temperature,
        system: request.systemPrompt,
        messages: request.messages.map(toAnthropicMessage),
        ...(request.tools && request.tools.length > 0
          ? { tools: request.tools.map(toAnthropicTool) }
          : {}),
      }),
      signal: signal ?? null,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      const error = new AiProviderHttpError(this.providerName, response.status, body);
      yield { type: "error", message: error.message, retryable: error.isRetryable };
      return;
    }

    const activeBlocks = new Map<number, ActiveBlock>();

    for await (const payload of readSseEvents(response)) {
      const event = JSON.parse(payload) as AnthropicStreamEvent;

      if (event.type === "content_block_start") {
        const block = event.content_block;
        activeBlocks.set(event.index, {
          type: block.type,
          toolUseId: block.id,
          toolUseName: block.name,
          jsonBuffer: "",
        });
        continue;
      }

      if (event.type === "content_block_delta") {
        const active = activeBlocks.get(event.index);
        if (!active) {
          continue;
        }
        if (event.delta.type === "text_delta" && event.delta.text) {
          yield { type: "text_delta", text: event.delta.text };
        } else if (event.delta.type === "input_json_delta" && event.delta.partial_json) {
          active.jsonBuffer += event.delta.partial_json;
        }
        continue;
      }

      if (event.type === "content_block_stop") {
        const active = activeBlocks.get(event.index);
        if (active?.type === "tool_use" && active.toolUseId && active.toolUseName) {
          yield {
            type: "tool_call",
            toolCall: {
              id: active.toolUseId,
              name: active.toolUseName,
              arguments: safeParseJsonObject(active.jsonBuffer),
            },
          };
        }
        continue;
      }

      if (event.type === "message_delta") {
        const stopReason = mapStopReason(event.delta.stop_reason);
        if (stopReason) {
          yield { type: "done", stopReason };
        }
        continue;
      }
    }
  }
}

type AnthropicStreamEvent =
  | {
      type: "content_block_start";
      index: number;
      content_block: { type: "text" | "tool_use"; id?: string; name?: string };
    }
  | {
      type: "content_block_delta";
      index: number;
      delta:
        { type: "text_delta"; text: string } | { type: "input_json_delta"; partial_json: string };
    }
  | { type: "content_block_stop"; index: number }
  | { type: "message_delta"; delta: { stop_reason: string | null } }
  | { type: "message_start" | "message_stop" | "ping" };

function mapStopReason(reason: string | null): "end_turn" | "tool_use" | "max_tokens" | undefined {
  if (reason === "tool_use") {
    return "tool_use";
  }
  if (reason === "max_tokens") {
    return "max_tokens";
  }
  if (reason === "end_turn" || reason === "stop_sequence") {
    return "end_turn";
  }
  return undefined;
}

function toAnthropicMessage(message: AiMessage): Record<string, unknown> {
  if (message.role === "tool") {
    return {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: message.toolCallId, content: message.content }],
    };
  }
  if (message.role === "assistant" && message.toolCalls && message.toolCalls.length > 0) {
    const content: unknown[] = [];
    if (message.content) {
      content.push({ type: "text", text: message.content });
    }
    for (const call of message.toolCalls) {
      content.push({ type: "tool_use", id: call.id, name: call.name, input: call.arguments });
    }
    return { role: "assistant", content };
  }
  return { role: message.role, content: message.content };
}

function toAnthropicTool(tool: AiToolDefinition): Record<string, unknown> {
  return { name: tool.name, description: tool.description, input_schema: tool.parameters };
}

function safeParseJsonObject(json: string): Record<string, unknown> {
  if (!json) {
    return {};
  }
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return {};
  }
}
