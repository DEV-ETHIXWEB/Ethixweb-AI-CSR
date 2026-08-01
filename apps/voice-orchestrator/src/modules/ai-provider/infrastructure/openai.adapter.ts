import type {
  AiCompletionChunk,
  AiCompletionRequest,
  AiMessage,
  AiProviderPort,
  AiToolDefinition,
} from "../domain/ai-provider.port";
import { AiProviderHttpError } from "../domain/errors";
import { readSseEvents } from "./sse-stream.util";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";

interface OpenAiDeltaToolCall {
  index: number;
  id?: string;
  function?: { name?: string; arguments?: string };
}

/**
 * OpenAI Chat Completions streaming adapter.
 *
 * UNVERIFIED AGAINST A LIVE SANDBOX — request/response shapes mapped from
 * OpenAI's publicly documented Chat Completions streaming + function-calling
 * format as of this build, the same "no live credentials in this
 * environment to confirm against" epistemic honesty already applied to
 * every CRM adapter in apps/core-api (docs/05 §2.9's [Confirmed]/[Unverified]
 * tagging). Verify against a real API key before production traffic.
 */
export class OpenAiAdapter implements AiProviderPort {
  readonly providerName = "openai";

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string = DEFAULT_BASE_URL,
  ) {}

  async *streamCompletion(
    request: AiCompletionRequest,
    signal?: AbortSignal,
  ): AsyncIterable<AiCompletionChunk> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: request.model,
        stream: true,
        max_tokens: request.maxTokens,
        temperature: request.temperature,
        messages: [
          { role: "system", content: request.systemPrompt },
          ...request.messages.map(toOpenAiMessage),
        ],
        ...(request.tools && request.tools.length > 0
          ? { tools: request.tools.map(toOpenAiTool) }
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

    const pendingToolCalls = new Map<number, { id: string; name: string; argsJson: string }>();

    for await (const payload of readSseEvents(response)) {
      if (payload === "[DONE]") {
        break;
      }
      const parsed = JSON.parse(payload) as {
        choices: Array<{
          delta: { content?: string; tool_calls?: OpenAiDeltaToolCall[] };
          finish_reason: string | null;
        }>;
      };
      const choice = parsed.choices[0];
      if (!choice) {
        continue;
      }

      if (choice.delta.content) {
        yield { type: "text_delta", text: choice.delta.content };
      }

      for (const deltaCall of choice.delta.tool_calls ?? []) {
        const existing = pendingToolCalls.get(deltaCall.index);
        pendingToolCalls.set(deltaCall.index, {
          id: deltaCall.id ?? existing?.id ?? "",
          name: deltaCall.function?.name ?? existing?.name ?? "",
          argsJson: (existing?.argsJson ?? "") + (deltaCall.function?.arguments ?? ""),
        });
      }

      if (choice.finish_reason === "tool_calls") {
        for (const call of pendingToolCalls.values()) {
          yield {
            type: "tool_call",
            toolCall: {
              id: call.id,
              name: call.name,
              arguments: safeParseJsonObject(call.argsJson),
            },
          };
        }
        yield { type: "done", stopReason: "tool_use" };
        return;
      }
      if (choice.finish_reason === "length") {
        yield { type: "done", stopReason: "max_tokens" };
        return;
      }
      if (choice.finish_reason === "stop") {
        yield { type: "done", stopReason: "end_turn" };
        return;
      }
    }
  }
}

function toOpenAiMessage(message: AiMessage): Record<string, unknown> {
  if (message.role === "tool") {
    return { role: "tool", tool_call_id: message.toolCallId, content: message.content };
  }
  if (message.role === "assistant" && message.toolCalls && message.toolCalls.length > 0) {
    return {
      role: "assistant",
      content: message.content || null,
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id,
        type: "function",
        function: { name: call.name, arguments: JSON.stringify(call.arguments) },
      })),
    };
  }
  return { role: message.role, content: message.content };
}

function toOpenAiTool(tool: AiToolDefinition): Record<string, unknown> {
  return {
    type: "function",
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  };
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
