/**
 * Typed client for voice-orchestrator's Voice Runtime contract
 * (docs/24-runtime-orchestrator-contract.md), modeled on
 * apps/voice-orchestrator/src/modules/tool-broker/infrastructure/http-core-api-client.ts:
 * plain fetch, Bearer token, retryable-vs-not error classification. The one
 * behavior docs/24 §2.2 calls out as "the single most important integration
 * detail in this document": a retry of an ambiguous outcome (timeout,
 * connection reset, 5xx, 409-in-flight) MUST reuse the exact same
 * `idempotencyKey`, never mint a new one. That's enforced structurally here
 * — `sendTurn` retries the identical request body it was given; the caller
 * generates the key exactly once, before the first attempt.
 */

export interface ConversationState {
  id: string;
  tenantId: string;
  businessId: string;
  callId: string;
  state: string;
  llmModel: string;
  leadId: string | null;
  turnCount: number;
  startedAt: string;
  endedAt: string | null;
  endReason: string | null;
}

export interface TurnResult {
  conversationId: string;
  responseText: string;
  toolCallsExecuted: string[];
  interrupted: boolean;
  state: string;
  transferTargets: string[] | null;
}

export interface StartConversationInput {
  tenantId: string;
  businessId: string;
  callId: string;
  callerAni: string;
  toNumber?: string;
  timezone?: string;
}

export interface SendTurnInput {
  tenantId: string;
  idempotencyKey: string;
  transcript: string;
  sttConfidence?: number;
  offsetMs?: number;
  allowedTools: string[];
}

export class OrchestratorHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "OrchestratorHttpError";
  }
}

/** A conversation already exists for this callId (docs/24 §2.1) — not a failure, the caller should look it up via findByCallId. */
export class ConversationAlreadyStartedError extends Error {
  constructor(callId: string) {
    super(`A conversation already exists for call ${callId}`);
    this.name = "ConversationAlreadyStartedError";
  }
}

export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
}

const DEFAULT_RETRY: RetryOptions = { maxAttempts: 4, baseDelayMs: 250 };

function isRetryableStatus(status: number): boolean {
  // 409 included deliberately: a turn retry may land on TurnAlreadyInFlight
  // (docs/24 §2.2) — not fatal, safe to back off and retry the identical
  // key, which then either completes normally or returns the cached result.
  return status === 409 || status === 429 || status >= 500;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class OrchestratorClient {
  constructor(
    private readonly baseUrl: string,
    private readonly serviceToken: string,
  ) {}

  async startConversation(input: StartConversationInput): Promise<ConversationState> {
    // No trailing slash: NestJS's Fastify adapter treats "/conversations"
    // and "/conversations/" as distinct routes (Fastify's ignoreTrailingSlash
    // defaults to false, and main.ts doesn't override it) — the controller
    // is registered at "/conversations", not "/conversations/".
    const response = await this.requestWithRetry("POST", "", input, DEFAULT_RETRY);
    return response as ConversationState;
  }

  /** The one call where retries MUST reuse `input.idempotencyKey` verbatim — see this file's own header comment. */
  async sendTurn(
    conversationId: string,
    input: SendTurnInput,
    signal?: AbortSignal,
  ): Promise<TurnResult> {
    const response = await this.requestWithRetry(
      "POST",
      `/${conversationId}/turns`,
      input,
      DEFAULT_RETRY,
      signal,
    );
    return response as TurnResult;
  }

  async interrupt(conversationId: string, tenantId: string): Promise<ConversationState> {
    const response = await this.requestWithRetry(
      "POST",
      `/${conversationId}/interrupt`,
      { tenantId },
      DEFAULT_RETRY,
    );
    return response as ConversationState;
  }

  async endConversation(
    conversationId: string,
    tenantId: string,
    endReason: string,
  ): Promise<ConversationState> {
    const response = await this.requestWithRetry(
      "POST",
      `/${conversationId}/end`,
      { tenantId, endReason },
      DEFAULT_RETRY,
    );
    return response as ConversationState;
  }

  /** docs/24 §5 — for a runtime process that restarted mid-call and lost its cached conversationId. */
  async findByCallId(tenantId: string, callId: string): Promise<ConversationState | null> {
    try {
      const response = await this.requestWithRetry(
        "GET",
        `/by-call/${callId}?tenantId=${encodeURIComponent(tenantId)}`,
        undefined,
        DEFAULT_RETRY,
      );
      return response as ConversationState;
    } catch (error) {
      if (error instanceof OrchestratorHttpError && error.status === 404) {
        return null;
      }
      throw error;
    }
  }

  private async requestWithRetry(
    method: "GET" | "POST",
    path: string,
    body: unknown,
    retry: RetryOptions,
    signal?: AbortSignal,
  ): Promise<unknown> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= retry.maxAttempts; attempt++) {
      if (signal?.aborted) {
        throw new DOMException("Turn aborted (barge-in)", "AbortError");
      }

      try {
        return await this.request(method, path, body, signal);
      } catch (error) {
        lastError = error;

        if (signal?.aborted) {
          throw error;
        }
        if (error instanceof OrchestratorHttpError) {
          if (error.status === 409 && path === "") {
            throw new ConversationAlreadyStartedError(String((body as { callId?: string })?.callId));
          }
          if (!isRetryableStatus(error.status)) {
            throw error;
          }
        }
        // Network error (fetch rejects with TypeError) or a retryable HTTP
        // status: back off and retry with the IDENTICAL body/idempotencyKey.
        if (attempt < retry.maxAttempts) {
          await sleep(retry.baseDelayMs * 2 ** (attempt - 1));
        }
      }
    }

    throw lastError;
  }

  private async request(
    method: "GET" | "POST",
    path: string,
    body: unknown,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}/conversations${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.serviceToken}`,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      ...(signal ? { signal } : {}),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new OrchestratorHttpError(
        response.status,
        `voice-orchestrator ${method} ${path} failed (${response.status}): ${text}`,
      );
    }

    return await response.json();
  }
}
