import { createNoopLogger } from "../../call-session/application/__fakes__/fake-logger";
import { OrchestratorConflictError } from "../domain/orchestrator-client.port";
import { HttpOrchestratorClient } from "./http-orchestrator-client";

/**
 * Unlike the port fakes used throughout call-session's own specs, THIS
 * adapter's job is exactly the HTTP status-code -> error-type mapping
 * docs/28 §N documents — worth testing against a real (stubbed) `fetch`
 * rather than only indirectly through a higher-level use case.
 */
function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers });
}

/** `POST /turns` (docs/28 §C.3) — one JSON object per line, NOT a JSON array. */
function ndjsonResponse(lines: Array<Record<string, unknown>>) {
  const body = lines.map((line) => JSON.stringify(line)).join("\n") + "\n";
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8" },
  });
}

/**
 * Regression fixture for a real live-call failure: `new Response(string)`
 * (what `ndjsonResponse` above builds) always has its whole body already
 * buffered, so its reader reaches EOF essentially instantly regardless of
 * whether the CLIENT code correctly stops reading after the "done" line
 * or incorrectly keeps waiting for the stream to close — that bug was
 * invisible to every other test in this file. This constructs a
 * `ReadableStream` that enqueues the NDJSON bytes once and then
 * deliberately NEVER calls `controller.close()` — exactly what a
 * keep-alive HTTP connection that doesn't promptly signal EOF back to
 * this specific reader looks like from `fetch`'s perspective. A client
 * that (incorrectly) waits for the stream to close after "done" hangs
 * forever here; the fix (stop reading once the "done"/"error" line is
 * parsed) resolves immediately regardless.
 */
function ndjsonResponseThatNeverCloses(lines: Array<Record<string, unknown>>): Response {
  const body = lines.map((line) => JSON.stringify(line)).join("\n") + "\n";
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      // Deliberately no controller.close() — see this function's own comment.
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8" },
  });
}

describe("HttpOrchestratorClient", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env["VOICE_ORCHESTRATOR_BASE_URL"] = "http://orchestrator.invalid";
    process.env["ORCHESTRATOR_SERVICE_TOKEN"] = "test-token";
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  function buildClient() {
    return new HttpOrchestratorClient(createNoopLogger());
  }

  it("sends the bearer token and correct path/body on startConversation", async () => {
    const fetchSpy = jest.fn().mockResolvedValue(
      jsonResponse(201, {
        id: "conv-1",
        tenantId: "t1",
        businessId: "b1",
        callId: "c1",
        state: "greeting",
        llmModel: "gpt-4o",
        leadId: null,
        turnCount: 0,
        startedAt: "2026-01-01T00:00:00.000Z",
        endedAt: null,
        endReason: null,
      }),
    );
    global.fetch = fetchSpy;
    const client = buildClient();

    const result = await client.startConversation({
      tenantId: "t1",
      businessId: "b1",
      callId: "c1",
      callerAni: "+15551234567",
    });

    expect(result.id).toBe("conv-1");
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://orchestrator.invalid/v1/conversations");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer test-token");
    expect(JSON.parse(init.body as string)).toMatchObject({ callId: "c1" });
  });

  /**
   * Regression coverage for a real bug found live: startConversation,
   * interrupt, and endConversation never accepted an AbortSignal at all,
   * and handleTurn's own signal is barge-in interrupt only (undefined on
   * an ordinary turn), so nothing anywhere on this client bounded a
   * request to voice-orchestrator, the actual live call path from Twilio
   * connecting through every turn to hangup. A hung (not erroring, not
   * unreachable) voice-orchestrator response would have left a real caller
   * in dead air for the rest of the call, or a hangup itself hanging.
   */
  it("always passes a defined AbortSignal to fetch, even on calls that never accepted one before this fix, so a hung voice-orchestrator response is never left completely unbounded", async () => {
    const fetchSpy = jest.fn().mockResolvedValue(jsonResponse(200, { id: "conv-1" }));
    global.fetch = fetchSpy;
    const client = buildClient();

    await client.endConversation("conv-1", { tenantId: "t1", endReason: "caller_hangup" });

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.signal?.aborted).toBe(false);
  });

  it("maps a 429 response into OrchestratorCapacityExceededError carrying waitingExperience and retryAfterSeconds", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      jsonResponse(
        429,
        {
          statusCode: 429,
          message: "capacity exceeded",
          error: "CapacityExceededError",
          retryAfterSeconds: 12,
          waitingExperience: {
            brochureSegment: { id: "seg-1", text: "We're licensed and insured." },
            overflowNumber: "+15559990000",
          },
        },
        { "Retry-After": "12" },
      ),
    );
    const client = buildClient();

    await expect(
      client.startConversation({
        tenantId: "t1",
        businessId: "b1",
        callId: "c1",
        callerAni: "+15551234567",
      }),
    ).rejects.toMatchObject({
      name: "OrchestratorCapacityExceededError",
      retryAfterSeconds: 12,
      waitingExperience: { brochureSegment: { id: "seg-1" }, overflowNumber: "+15559990000" },
    });
  });

  it("maps a 409 response into OrchestratorConflictError", async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse(409, { message: "already exists" }));
    const client = buildClient();

    await expect(
      client.startConversation({
        tenantId: "t1",
        businessId: "b1",
        callId: "c1",
        callerAni: "+15551234567",
      }),
    ).rejects.toBeInstanceOf(OrchestratorConflictError);
  });

  it("maps a 500 response into a retryable OrchestratorHttpError", async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse(500, { message: "boom" }));
    const client = buildClient();

    await expect(
      client.handleTurn("conv-1", {
        tenantId: "t1",
        idempotencyKey: "k1",
        transcript: "hi",
        allowedTools: ["searchCustomer"],
      }),
    ).rejects.toMatchObject({ name: "OrchestratorHttpError", statusCode: 500, retryable: true });
  });

  it("maps a 400 response into a non-retryable OrchestratorHttpError", async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse(400, { message: "bad request" }));
    const client = buildClient();

    await expect(
      client.handleTurn("conv-1", {
        tenantId: "t1",
        idempotencyKey: "k1",
        transcript: "hi",
        allowedTools: [],
      }),
    ).rejects.toMatchObject({ name: "OrchestratorHttpError", statusCode: 400, retryable: false });
  });

  it("propagates an AbortError untouched when the caller's signal fires mid-request (barge-in mid-turn abort)", async () => {
    const controller = new AbortController();
    global.fetch = jest.fn().mockImplementation(() => {
      controller.abort();
      return Promise.reject(new DOMException("aborted", "AbortError"));
    });
    const client = buildClient();

    await expect(
      client.handleTurn(
        "conv-1",
        { tenantId: "t1", idempotencyKey: "k1", transcript: "hi", allowedTools: [] },
        controller.signal,
      ),
    ).rejects.toThrow("aborted");
  });

  it("throws a retryable OrchestratorHttpError on a genuine network failure (not an abort)", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const client = buildClient();

    await expect(
      client.endConversation("conv-1", { tenantId: "t1", endReason: "caller_hangup" }),
    ).rejects.toMatchObject({ name: "OrchestratorHttpError", retryable: true });
  });

  /**
   * `/turns` (docs/28 §C.3) streams NDJSON rather than one blocking JSON
   * body — this is the actual "does this client correctly consume the
   * new contract" proof, distinct from the status-code-mapping tests
   * above (which never touch a real streamed body since they all fail
   * before the streaming path is ever reached).
   */
  describe("streaming /turns (docs/28 §C.3)", () => {
    it("dispatches each {type:'chunk'} line to onChunk, in order, before resolving with the final {type:'done'} line's TurnResult", async () => {
      global.fetch = jest.fn().mockResolvedValue(
        ndjsonResponse([
          { type: "chunk", text: "Let me check on that " },
          { type: "chunk", text: "for you." },
          {
            type: "done",
            conversationId: "conv-1",
            responseText: "Let me check on that for you.",
            toolCallsExecuted: [],
            interrupted: false,
            state: "qualifying",
          },
        ]),
      );
      const client = buildClient();
      const received: string[] = [];

      const result = await client.handleTurn(
        "conv-1",
        { tenantId: "t1", idempotencyKey: "k1", transcript: "hi", allowedTools: [] },
        undefined,
        (text) => {
          received.push(text);
        },
      );

      expect(received).toEqual(["Let me check on that ", "for you."]);
      expect(result).toMatchObject({
        conversationId: "conv-1",
        responseText: "Let me check on that for you.",
        state: "qualifying",
      });
      // The done line's own "type" field must not leak into the returned
      // TurnResult — it isn't part of that shape.
      expect(result).not.toHaveProperty("type");
    });

    /**
     * Regression test for a REAL live-call failure, not a hypothetical
     * one: a caller's 4th turn on a real call produced total silence —
     * voice-orchestrator's own logs showed the turn completing
     * normally server-side, but voice-runtime never logged a
     * completed round-trip for it at all, and no chunk was ever
     * spoken. Root cause: this client's stream-reading loop kept
     * calling `reader.read()` waiting for the underlying byte stream
     * to ALSO signal EOF even after it already had the `{type:"done"}`
     * line — turns 1-3 of that same call happened to complete because
     * the connection closed promptly; turn 4, reusing the same
     * keep-alive connection, didn't, and the caller said "hello, are
     * you still there?" into genuine silence. `ndjsonResponseThatNeverCloses`
     * reproduces exactly that: a stream that delivers the done line but
     * never closes. Bounded by Jest's own test timeout — if this
     * regresses, the test hangs and times out rather than failing fast,
     * which is itself the correct signal (that IS the bug's real-world
     * shape: silence, not an error).
     */
    it("resolves as soon as the {type:'done'} line arrives — does not wait for the connection to also close", async () => {
      global.fetch = jest.fn().mockResolvedValue(
        ndjsonResponseThatNeverCloses([
          { type: "chunk", text: "Got it, one moment." },
          {
            type: "done",
            conversationId: "conv-1",
            responseText: "Got it, one moment.",
            toolCallsExecuted: [],
            interrupted: false,
            state: "qualifying",
          },
        ]),
      );
      const client = buildClient();
      const received: string[] = [];

      const result = await client.handleTurn(
        "conv-1",
        { tenantId: "t1", idempotencyKey: "k1", transcript: "hi", allowedTools: [] },
        undefined,
        (text) => {
          received.push(text);
        },
      );

      expect(received).toEqual(["Got it, one moment."]);
      expect(result.responseText).toBe("Got it, one moment.");
    });

    /**
     * Regression test for a SECOND, distinct real live-call failure —
     * found on the very next call after the fix above shipped: several
     * turns across one real call went completely silent again, but
     * this time voice-orchestrator's own logs showed the connection
     * being closed mid-response (sometimes AFTER one or more chunks had
     * already streamed and been spoken), and voice-runtime logged
     * NOTHING at all for them — no completed round-trip, no retry, not
     * even the existing "mid-stream failure after partial chunks, not
     * retrying" branch handleFinalTranscript already has. That absence
     * of ANY log, success or failure, is the signature of a promise
     * that never settles: `reader.read()` itself neither resolved nor
     * rejected, hanging indefinitely — unbounded even by
     * REQUEST_TIMEOUT_MS's own AbortSignal.timeout, which assumes
     * aborting the fetch also unblocks any pending read on its body
     * stream, an assumption that doesn't reliably hold for every
     * connection-close shape this environment has produced live. This
     * reproduces exactly that: one real chunk arrives (so the caller
     * really did hear something, matching the live case), then the
     * stream goes completely silent — no more data, no close, no
     * error — forever. Real 8s wait (not fake timers) so this proves
     * the ACTUAL production timeout value actually fires, not just that
     * some mechanism theoretically could.
     */
    it("does not hang forever when the stream delivers a chunk and then goes silent with no more data and no close", async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValue(
          ndjsonResponseThatNeverCloses([{ type: "chunk", text: "Let me check on that." }]),
        );
      const client = buildClient();
      const received: string[] = [];

      await expect(
        client.handleTurn(
          "conv-1",
          { tenantId: "t1", idempotencyKey: "k1", transcript: "hi", allowedTools: [] },
          undefined,
          (text) => {
            received.push(text);
          },
        ),
      ).rejects.toMatchObject({ retryable: true });

      // The chunk that streamed BEFORE the stall must still have
      // reached the caller — a real caller may already be speaking
      // it, exactly as happened on the real call this test reproduces.
      expect(received).toEqual(["Let me check on that."]);
    }, 12_000);

    it("resolves correctly with no onChunk callback at all (streaming stays purely additive)", async () => {
      global.fetch = jest.fn().mockResolvedValue(
        ndjsonResponse([
          { type: "chunk", text: "hi there" },
          {
            type: "done",
            conversationId: "conv-1",
            responseText: "hi there",
            toolCallsExecuted: [],
            interrupted: false,
            state: "qualifying",
          },
        ]),
      );
      const client = buildClient();

      const result = await client.handleTurn("conv-1", {
        tenantId: "t1",
        idempotencyKey: "k1",
        transcript: "hi",
        allowedTools: [],
      });

      expect(result.responseText).toBe("hi there");
    });

    it("throws an OrchestratorHttpError carrying the stream event's own retryable flag when a mid-stream {type:'error'} line arrives", async () => {
      global.fetch = jest.fn().mockResolvedValue(
        ndjsonResponse([
          { type: "chunk", text: "Let me check on that." },
          { type: "error", message: "AI provider completion failed: boom", retryable: true },
        ]),
      );
      const client = buildClient();
      const received: string[] = [];

      await expect(
        client.handleTurn(
          "conv-1",
          { tenantId: "t1", idempotencyKey: "k1", transcript: "hi", allowedTools: [] },
          undefined,
          (text) => {
            received.push(text);
          },
        ),
      ).rejects.toMatchObject({ name: "OrchestratorHttpError", retryable: true });
      // The chunk that streamed BEFORE the error must still have reached
      // the caller — a real caller may already be speaking it.
      expect(received).toEqual(["Let me check on that."]);
    });

    it("throws a retryable OrchestratorHttpError when the stream ends with no 'done' line at all", async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValue(ndjsonResponse([{ type: "chunk", text: "partial" }]));
      const client = buildClient();

      await expect(
        client.handleTurn("conv-1", {
          tenantId: "t1",
          idempotencyKey: "k1",
          transcript: "hi",
          allowedTools: [],
        }),
      ).rejects.toMatchObject({ name: "OrchestratorHttpError", retryable: true });
    });
  });
});
