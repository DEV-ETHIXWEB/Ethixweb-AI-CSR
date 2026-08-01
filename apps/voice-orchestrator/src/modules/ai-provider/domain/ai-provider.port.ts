export type AiRole = "system" | "user" | "assistant" | "tool";

/** JSON-Schema-shaped tool parameter description — passed through verbatim to whichever provider's own tool-calling format needs it (each adapter maps this into its vendor-specific wire shape, see infrastructure/*.adapter.ts). */
export interface AiToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface AiToolCallRequest {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface AiMessage {
  role: AiRole;
  content: string;
  /** Set when role === "tool" — which prior tool_call this message is the result of. */
  toolCallId?: string;
  /** Set when role === "assistant" and the model requested tool calls (content may be empty). */
  toolCalls?: AiToolCallRequest[];
}

export interface AiCompletionRequest {
  /** Vendor-specific model identifier — resolved from AgentConfig.llmModel per docs/03 §1, not hardcoded here. */
  model: string;
  systemPrompt: string;
  messages: AiMessage[];
  tools?: AiToolDefinition[];
  maxTokens?: number;
  temperature?: number;
}

/**
 * The provider-agnostic streaming unit every adapter normalizes its vendor's
 * own SSE format into — this is what the rest of the orchestrator (Turn
 * Manager, docs/03) actually consumes, so a provider swap never touches
 * conversation-engine code, per docs/21-provider-abstraction-and-vendor-risk.md.
 */
export type AiCompletionChunk =
  | { type: "text_delta"; text: string }
  | { type: "tool_call"; toolCall: AiToolCallRequest }
  | { type: "done"; stopReason: "end_turn" | "tool_use" | "max_tokens" }
  | { type: "error"; message: string; retryable: boolean };

export interface AiProviderPort {
  readonly providerName: string;
  /** Cooperative cancellation via `signal` — the caller (Turn Manager, on barge-in) aborts mid-stream; the adapter must stop consuming/yielding promptly, not just stop being awaited. */
  streamCompletion(
    request: AiCompletionRequest,
    signal?: AbortSignal,
  ): AsyncIterable<AiCompletionChunk>;
}

export const AI_PROVIDER_ROUTER = Symbol("AI_PROVIDER_ROUTER");
