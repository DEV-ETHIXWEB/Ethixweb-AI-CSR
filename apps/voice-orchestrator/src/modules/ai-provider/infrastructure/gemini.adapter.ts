import type {
  AiCompletionChunk,
  AiCompletionRequest,
  AiMessage,
  AiProviderPort,
  AiToolDefinition,
} from "../domain/ai-provider.port";
import { AiProviderHttpError } from "../domain/errors";
import { readSseEvents } from "./sse-stream.util";

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

/**
 * Google Gemini (Generative Language API) streaming adapter.
 *
 * UNVERIFIED AGAINST A LIVE SANDBOX — same caveat as the other two
 * adapters. Gemini's wire format differs from both OpenAI's and
 * Anthropic's in a way worth calling out explicitly: it has no distinct
 * "tool" role — a tool result is sent back as a `user`-role message
 * containing a `functionResponse` part, and it needs the ORIGINAL
 * function's name (not just the call id) to do that, which this adapter
 * recovers by scanning backward through the conversation for the
 * assistant `toolCalls` entry matching this message's `toolCallId` — the
 * one piece of `AiMessage` mapping that genuinely needs the full message
 * list, not just the current message.
 */
export class GeminiAdapter implements AiProviderPort {
  readonly providerName = "gemini";

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string = DEFAULT_BASE_URL,
  ) {}

  async *streamCompletion(
    request: AiCompletionRequest,
    signal?: AbortSignal,
  ): AsyncIterable<AiCompletionChunk> {
    const url = `${this.baseUrl}/models/${encodeURIComponent(request.model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(this.apiKey)}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: request.systemPrompt }] },
        contents: toGeminiContents(request.messages),
        ...(request.tools && request.tools.length > 0
          ? { tools: [{ functionDeclarations: request.tools.map(toGeminiFunctionDeclaration) }] }
          : {}),
        generationConfig: {
          ...(request.maxTokens !== undefined ? { maxOutputTokens: request.maxTokens } : {}),
          ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
        },
      }),
      signal: signal ?? null,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      const error = new AiProviderHttpError(this.providerName, response.status, body);
      yield { type: "error", message: error.message, retryable: error.isRetryable };
      return;
    }

    let sawToolCall = false;

    for await (const payload of readSseEvents(response)) {
      const parsed = JSON.parse(payload) as GeminiStreamChunk;
      const candidate = parsed.candidates?.[0];
      if (!candidate) {
        continue;
      }

      for (const part of candidate.content?.parts ?? []) {
        if (part.text) {
          yield { type: "text_delta", text: part.text };
        }
        if (part.functionCall) {
          sawToolCall = true;
          yield {
            type: "tool_call",
            toolCall: {
              // Gemini doesn't assign a call id — synthesized deterministically
              // per response so the eventual tool-result message can reference
              // it the same way the other two providers' real ids are used.
              id: `gemini-call-${part.functionCall.name}-${Date.now()}`,
              name: part.functionCall.name,
              arguments: part.functionCall.args ?? {},
            },
          };
        }
      }

      if (candidate.finishReason) {
        yield { type: "done", stopReason: mapFinishReason(candidate.finishReason, sawToolCall) };
        return;
      }
    }
  }
}

interface GeminiStreamChunk {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
        functionCall?: { name: string; args?: Record<string, unknown> };
      }>;
    };
    finishReason?: string;
  }>;
}

function mapFinishReason(
  reason: string,
  sawToolCall: boolean,
): "end_turn" | "tool_use" | "max_tokens" {
  if (reason === "MAX_TOKENS") {
    return "max_tokens";
  }
  if (sawToolCall) {
    return "tool_use";
  }
  return "end_turn";
}

function toGeminiContents(messages: AiMessage[]): Array<Record<string, unknown>> {
  return messages.map((message, index) => {
    if (message.role === "tool") {
      const callerName = findToolCallName(messages, index, message.toolCallId);
      return {
        role: "user",
        parts: [{ functionResponse: { name: callerName, response: { content: message.content } } }],
      };
    }
    if (message.role === "assistant" && message.toolCalls && message.toolCalls.length > 0) {
      return {
        role: "model",
        parts: message.toolCalls.map((call) => ({
          functionCall: { name: call.name, args: call.arguments },
        })),
      };
    }
    return {
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }],
    };
  });
}

function findToolCallName(
  messages: AiMessage[],
  fromIndex: number,
  toolCallId: string | undefined,
): string {
  if (!toolCallId) {
    return "unknown_tool";
  }
  for (let i = fromIndex - 1; i >= 0; i--) {
    const candidate = messages[i]?.toolCalls?.find((call) => call.id === toolCallId);
    if (candidate) {
      return candidate.name;
    }
  }
  return "unknown_tool";
}

function toGeminiFunctionDeclaration(tool: AiToolDefinition): Record<string, unknown> {
  return { name: tool.name, description: tool.description, parameters: tool.parameters };
}
