import { Inject, Injectable } from "@nestjs/common";
import type { StructuredLogger } from "@ethixweb/shared-kernel";
import { APP_LOGGER } from "../../../shared/observability/app-logger.module";
import {
  OrchestratorCapacityExceededError,
  OrchestratorConflictError,
  OrchestratorHttpError,
  type ConversationResponse,
  type EndConversationRequest,
  type HandleTurnRequest,
  type InterruptRequest,
  type OrchestratorClientPort,
  type StartConversationRequest,
  type TurnResult,
} from "../domain/orchestrator-client.port";

// None of startConversation/interrupt/endConversation ever accepted a
// signal at all, and handleTurn's own signal parameter is barge-in
// interrupt only (undefined on an ordinary turn), so nothing anywhere on
// this client bounded a request to voice-orchestrator, the actual live
// call path from the moment Twilio's Media Stream connects through every
// turn to hangup. Same unbounded-fetch bug class found and fixed in
// voice-orchestrator's own HttpCoreApiClient and FallbackAiProvider: a
// hung (not erroring, not unreachable, genuinely hung) voice-orchestrator
// response would leave a real caller in dead air for the rest of the
// call, or a hangup itself hanging. Set above voice-orchestrator's own
// worst-case internal processing time (a 15s LLM call plus however many
// per-tool calls a turn makes, see FallbackAiProvider's own
// STREAM_TIMEOUT_MS comment) so a slow-but-genuinely-recovering
// voice-orchestrator response isn't mistaken for a hang and retried
// prematurely by CallSessionOrchestrator's own turn-retry loop.
const REQUEST_TIMEOUT_MS = 20_000;

/**
 * Implements docs/28 §A-§C exactly, every path/verb/body shape here is
 * copied from that contract, not invented. `fetch` (Node 22's built-in),
 * matching HttpCoreApiClient's own choice in voice-orchestrator rather than
 * pulling in axios/got for a single outbound client.
 */
@Injectable()
export class HttpOrchestratorClient implements OrchestratorClientPort {
  constructor(@Inject(APP_LOGGER) private readonly logger: StructuredLogger) {}

  private get baseUrl(): string {
    const url = process.env["VOICE_ORCHESTRATOR_BASE_URL"];
    if (!url) {
      throw new Error("VOICE_ORCHESTRATOR_BASE_URL is not configured");
    }
    return url.replace(/\/+$/, "");
  }

  private get token(): string {
    const token = process.env["ORCHESTRATOR_SERVICE_TOKEN"];
    if (!token) {
      throw new Error("ORCHESTRATOR_SERVICE_TOKEN is not configured");
    }
    return token;
  }

  async startConversation(req: StartConversationRequest): Promise<ConversationResponse> {
    return this.request<ConversationResponse>("POST", "/conversations", req);
  }

  async handleTurn(
    conversationId: string,
    req: HandleTurnRequest,
    signal?: AbortSignal,
  ): Promise<TurnResult> {
    return this.request<TurnResult>("POST", `/conversations/${conversationId}/turns`, req, signal);
  }

  async interrupt(conversationId: string, req: InterruptRequest): Promise<ConversationResponse> {
    return this.request<ConversationResponse>(
      "POST",
      `/conversations/${conversationId}/interrupt`,
      req,
    );
  }

  async endConversation(
    conversationId: string,
    req: EndConversationRequest,
  ): Promise<ConversationResponse> {
    return this.request<ConversationResponse>("POST", `/conversations/${conversationId}/end`, req);
  }

  private async request<T>(
    method: string,
    path: string,
    body: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const boundedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/v1${path}`, {
        method,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.token}` },
        body: JSON.stringify(body),
        signal: boundedSignal,
      });
    } catch (error) {
      // A network-level failure (DNS, connection refused, the caller's own
      // interrupt AbortSignal firing, or the timeout above firing) is
      // indistinguishable from "ambiguous outcome" per docs/28 §G, so
      // callers must apply the SAME retry-with-same-idempotencyKey rule as
      // a 5xx, not treat this as a hard failure. The caller's own signal
      // (barge-in) still needs to propagate as-is rather than being
      // reframed as a retryable HTTP error, checked against the ORIGINAL
      // signal, not the combined one, since the combined signal is also
      // aborted whenever the timeout fires and that case must NOT take
      // this early-return branch.
      if (signal?.aborted) {
        throw error;
      }
      throw new OrchestratorHttpError(
        `${method} ${path} failed: ${error instanceof Error ? error.message : String(error)}`,
        0,
        true,
      );
    }

    if (response.status === 429) {
      const body429 = (await response.json().catch(() => null)) as {
        retryAfterSeconds?: number;
        waitingExperience?: {
          brochureSegment: { id: string; text: string } | null;
          overflowNumber: string | null;
        };
      } | null;
      const retryAfterHeader = response.headers.get("Retry-After");
      throw new OrchestratorCapacityExceededError(
        body429?.retryAfterSeconds ?? (retryAfterHeader ? Number(retryAfterHeader) : 5),
        body429?.waitingExperience ?? { brochureSegment: null, overflowNumber: null },
      );
    }

    if (response.status === 409) {
      const text = await response.text().catch(() => "");
      throw new OrchestratorConflictError(`${method} ${path} conflict (409): ${text}`);
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      const retryable = response.status >= 500;
      this.logger.warn("voice-orchestrator request failed", {
        method,
        path,
        statusCode: response.status,
      });
      throw new OrchestratorHttpError(
        `${method} ${path} failed (${response.status}): ${text}`,
        response.status,
        retryable,
      );
    }

    return (await response.json()) as T;
  }
}
