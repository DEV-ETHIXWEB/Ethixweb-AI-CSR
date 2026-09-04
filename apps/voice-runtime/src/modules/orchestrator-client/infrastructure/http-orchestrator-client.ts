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

// FOUND LIVE, not hypothetical: multiple turns across a single real call
// went completely silent — voice-orchestrator's own logs showed each one
// completing normally server-side (sometimes even after streaming one or
// two real chunks that got spoken), while voice-runtime never logged a
// completed round-trip, a retry, OR an error for any of them — not even
// the "mid-stream failure, don't retry" branch handleFinalTranscript
// already has for exactly this shape. The only explanation that fits:
// `reader.read()` itself never settled — neither resolved nor rejected —
// so the whole read loop hung indefinitely, unbounded even by
// REQUEST_TIMEOUT_MS's own AbortSignal.timeout, which assumes aborting
// the underlying fetch also unblocks any pending read on its body
// stream. That assumption doesn't reliably hold across every connection
// state this environment has produced live (voice-orchestrator's /turns
// response now sends `Connection: close`, i.e. a bare TCP FIN with no
// application-level signal a reader is guaranteed to observe promptly).
// Racing every individual read against its OWN short timeout, instead of
// only the request as a whole, means a stalled connection surfaces as an
// ordinary retryable error within seconds — through the exact retry/
// no-retry-after-partial-chunks logic that already exists — rather than
// silence with no bound at all.
const READ_IDLE_TIMEOUT_MS = 8_000;

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
    onChunk?: (text: string) => void | Promise<void>,
  ): Promise<TurnResult> {
    return this.requestTurnStream(`/conversations/${conversationId}/turns`, req, signal, onChunk);
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
    const response = await this.performRequest(method, path, body, signal);
    return (await response.json()) as T;
  }

  /**
   * `POST /turns` specifically (docs/28 §C.3) — streams
   * `application/x-ndjson` instead of one blocking JSON object, so this
   * shares `performRequest`'s fetch/status-code handling (identical
   * 404/409/5xx mapping — those all happen BEFORE voice-orchestrator
   * ever starts streaming, see that endpoint's own comment) but reads
   * the SUCCESSFUL body differently: line by line, dispatching each
   * `{type:"chunk"}` to `onChunk` as it arrives instead of waiting for
   * the whole thing.
   *
   * `onChunk` is awaited before reading the next network chunk, but
   * that's cheap: CallSessionOrchestrator's own `onChunk` never awaits
   * the actual TTS playback inline, it only chains it onto a speak
   * queue (see that class's own comment) — so this loop is never
   * actually blocked on how long speaking takes, only on how long
   * `onChunk` itself takes to RETURN, which is near-instant.
   */
  private async requestTurnStream(
    path: string,
    body: unknown,
    signal: AbortSignal | undefined,
    onChunk: ((text: string) => void | Promise<void>) | undefined,
  ): Promise<TurnResult> {
    const response = await this.performRequest("POST", path, body, signal);

    if (!response.body) {
      throw new OrchestratorHttpError(
        `POST ${path} succeeded with no response body to stream`,
        response.status,
        true,
      );
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let result: TurnResult | null = null;

    // FOUND LIVE, not hypothetical: a real call's 4th turn produced a
    // caller-audible "no response at all" — voice-orchestrator's own
    // logs showed the turn completing normally server-side (LLM
    // finished, "turn processing completed" logged), but voice-runtime
    // never logged "turn HTTP round-trip completed" for it at all, and
    // NO onChunk ever fired (no "TTS synthesis finished" either) — the
    // caller said "hello, are you still there?" into genuine silence.
    // Root cause: this loop kept calling `reader.read()` waiting for
    // the underlying byte stream to ALSO signal EOF, even after it
    // already had everything it needs from the `{type:"done"}` line —
    // the wire contract (docs/28 §C.3) guarantees "done"/"error" is
    // always the LAST line the server ever sends (the controller calls
    // `reply.raw.end()` immediately after writing it), so waiting for
    // the CONNECTION to also close on top of that is pure liability:
    // on a keep-alive connection that doesn't promptly signal close to
    // this specific reader (turns 1-3 of that same real call happened
    // to complete fine; turn 4, reusing the same connection, didn't),
    // this hangs forever with no error, no timeout short of the full
    // 20s AbortSignal.timeout — and the caller had already hung up in
    // frustration before that could even fire. Breaking as soon as
    // `result` is set removes the dependency on the connection ever
    // closing at all.
    try {
      for (;;) {
        const chunk = (await readWithIdleTimeout(reader, path, response.status)) as {
          done: boolean;
          value: Uint8Array | undefined;
        };
        if (chunk.done || !chunk.value) {
          break;
        }
        buffer += decoder.decode(chunk.value, { stream: true });
        let newlineIndex = buffer.indexOf("\n");
        while (newlineIndex !== -1) {
          const line = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);
          if (line.trim().length > 0) {
            result = await this.handleTurnStreamLine(path, line, onChunk, result);
          }
          newlineIndex = buffer.indexOf("\n");
        }
        if (result) {
          // Explicitly cancel rather than merely releasing the lock —
          // there's no guarantee the response is fully drained (the
          // whole reason this branch exists), and leaving a
          // partially-read body behind risks the underlying connection
          // being reused for the NEXT request with stale bytes still
          // buffered. `cancel()` tells fetch's implementation this
          // response is being deliberately abandoned, so it can decide
          // whether the connection is safe to keep alive or must be
          // closed — not something this code should guess at itself.
          await reader.cancel();
          return result;
        }
      }
    } finally {
      reader.releaseLock();
    }

    if (!result) {
      // The connection closed (or the fetch's own AbortSignal.timeout
      // fired) before a `{type:"done"}` line ever arrived — the SAME
      // ambiguous-outcome case docs/28 §G already documents for a
      // network-level failure, so it gets the same treatment: retryable,
      // NOT a hard failure. The caller's own barge-in signal still needs
      // to propagate as an abort rather than be reframed as this.
      if (signal?.aborted) {
        throw new DOMException("aborted", "AbortError");
      }
      throw new OrchestratorHttpError(
        `POST ${path} stream ended with no "done" line`,
        response.status,
        true,
      );
    }
    return result;
  }

  private async handleTurnStreamLine(
    path: string,
    line: string,
    onChunk: ((text: string) => void | Promise<void>) | undefined,
    resultSoFar: TurnResult | null,
  ): Promise<TurnResult | null> {
    const event = JSON.parse(line) as Record<string, unknown>;
    if (event["type"] === "chunk") {
      const text = typeof event["text"] === "string" ? event["text"] : "";
      await onChunk?.(text);
      return resultSoFar;
    }
    if (event["type"] === "error") {
      // Deliberately matches docs/28 §G's "5xx is always retryable"
      // semantics — this is exactly what an uncaught mid-turn error
      // would have produced as a 500 before voice-orchestrator's /turns
      // endpoint streamed at all (see that endpoint's own comment), so
      // no new retry-eligibility rule is needed here, only a new place
      // to read the existing signal from.
      const message = typeof event["message"] === "string" ? event["message"] : "unknown error";
      throw new OrchestratorHttpError(
        `POST ${path} failed mid-stream: ${message}`,
        200,
        event["retryable"] !== false,
      );
    }
    // event["type"] === "done"
    const { type: _type, ...rest } = event;
    return rest as unknown as TurnResult;
  }

  private async performRequest(
    method: string,
    path: string,
    body: unknown,
    signal?: AbortSignal,
  ): Promise<Response> {
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

    return response;
  }
}

/**
 * Races a single `reader.read()` call against `READ_IDLE_TIMEOUT_MS` —
 * see that constant's own comment for the real, live failure this
 * exists to bound. Rejects with a plain `Error` (not tied to any
 * specific fetch/DOM error type) on timeout so it's unambiguous in
 * logs and always retryable by `requestTurnStream`'s own caller, the
 * same way any other network-level ambiguous outcome is (docs/28 §G).
 * The timer is always cleared, on both the success and timeout paths —
 * an uncleared `setTimeout` here would otherwise keep Node's event
 * loop alive for up to 8s past a request that already finished.
 */
async function readWithIdleTimeout(
  reader: { read(): Promise<unknown> },
  path: string,
  responseStatus: number,
): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      // OrchestratorHttpError (not a plain Error) — matches this
      // file's own convention for every other network-level failure
      // here, and gives handleFinalTranscript's retry logic an
      // explicit, intentional `retryable: true` signal instead of
      // relying on the fallback `!(error instanceof
      // OrchestratorConflictError)` inference it would otherwise fall
      // through to.
      reject(
        new OrchestratorHttpError(
          `POST ${path} stream stalled — no data for ${READ_IDLE_TIMEOUT_MS}ms mid-response`,
          responseStatus,
          true,
        ),
      );
    }, READ_IDLE_TIMEOUT_MS);
  });
  const readPromise = reader.read();
  // If the timeout wins the race below, this same read() call is still
  // outstanding underneath — requestTurnStream's own
  // `finally { reader.releaseLock() }` will make it settle (reject)
  // shortly after, per the Streams spec, with nothing left awaiting it
  // directly. This shadow handler exists purely so THAT later rejection
  // doesn't surface as an unhandled promise rejection; it's attached to
  // `readPromise` itself, not to a derived promise, so it has no effect
  // on what actually gets raced below — a genuine read() error still
  // propagates through the race exactly as before this existed.
  readPromise.catch(() => undefined);
  try {
    return await Promise.race([readPromise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
