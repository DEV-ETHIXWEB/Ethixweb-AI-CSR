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
 *
 * PROMPT CACHING: found live during a cost-optimization pass — docs/03 §1
 * itself already names why this call assembles the system prompt ONCE per
 * call ("what makes provider-side prompt caching effective"), but nothing
 * ever actually set a `cache_control` breakpoint, so that design intent was
 * never realized; every turn re-billed the full system+tools+history prefix
 * at full price. A real multi-turn phone call is exactly the agent-loop
 * shape prompt caching exists for (docs/03 §2: turn N resends turns 1..N-1
 * in full) — Anthropic's own measurements put this lever at a 2.5-3.7x cost
 * reduction on that shape, the largest single lever available, with zero
 * effect on response quality (a cache hit returns byte-identical output to
 * a miss). Two breakpoints, the documented "agent loop" shape: one on the
 * system prompt (tools render before system in Anthropic's request order,
 * so this one marker covers both — allowedTools is fixed for the whole
 * call, per HandleTurnUseCase), one on the last message (so THIS turn's
 * full history is cached for the NEXT turn to hit). Default 5-minute TTL,
 * deliberately not the pricier 1-hour tier — a live call's turn gaps are
 * caller-speech-length, essentially always well under 5 minutes, so the
 * cheaper TTL already stays warm for the whole call.
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
    const messages = request.messages.map(toAnthropicMessage);
    markLastMessageCacheable(messages);

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
        system: [
          { type: "text", text: request.systemPrompt, cache_control: { type: "ephemeral" } },
        ],
        messages,
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
  if (message.role === "system") {
    // FOUND LIVE: a real call's history crossed context-window.ts's
    // DEFAULT_MAX_MESSAGES, which prepends a synthetic role:"system"
    // compaction summary into conversation.messages — the only source of
    // a mid-conversation role:"system" message anywhere in this codebase.
    // Falling through to the generic branch below sent it verbatim as
    // `messages[0]`, and Anthropic's Messages API rejects role "system"
    // anywhere inside `messages` at any position (only the top-level
    // `system` parameter above is valid) — a 400 on every single
    // subsequent turn for the rest of the call, 100% reproducible, not
    // intermittent. Folded into a user turn instead: the same choice
    // Gemini's adapter already makes (its own generic fallback maps any
    // non-assistant, non-tool role to "user"), and the summary's own text
    // already self-identifies as an aside ("[Earlier in this call —
    // ...summarized]"), so the model isn't misled into treating it as
    // something the caller said.
    return { role: "user", content: [{ type: "text", text: message.content }] };
  }
  // Content-block array, not a plain string — `cache_control` (see
  // markLastMessageCacheable) can only attach to a block, never to a bare
  // string `content` field, and every message must already be shaped this
  // way in case IT ends up being the last one this turn.
  return { role: message.role, content: [{ type: "text", text: message.content }] };
}

/**
 * Marks the last content block of the last message with a cache breakpoint
 * — see this file's class-level comment for why. A no-op on an empty array
 * (the very first turn of a call has no prior messages yet). Mutates the
 * already-mapped messages array in place; safe because `toAnthropicMessage`
 * just built it fresh for this one request.
 */
function markLastMessageCacheable(messages: Record<string, unknown>[]): void {
  const lastMessage = messages.at(-1);
  if (!lastMessage) {
    return;
  }
  const content = lastMessage["content"] as Record<string, unknown>[];
  const lastBlock = content.at(-1);
  if (lastBlock) {
    lastBlock["cache_control"] = { type: "ephemeral" };
  }
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
