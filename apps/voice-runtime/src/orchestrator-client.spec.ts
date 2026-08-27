import {
  ConversationAlreadyStartedError,
  OrchestratorClient,
  OrchestratorHttpError,
} from "./orchestrator-client.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function textResponse(status: number, text: string): Response {
  return new Response(text, { status });
}

describe("OrchestratorClient", () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });

  function buildClient(): OrchestratorClient {
    return new OrchestratorClient("http://localhost:3100/v1", "service-token");
  }

  it("sends the Authorization header and correct path/body on startConversation", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(201, { id: "conv-1", tenantId: "t1", callId: "call-1" }),
    );
    const client = buildClient();

    await client.startConversation({
      tenantId: "t1",
      businessId: "b1",
      callId: "call-1",
      callerAni: "+15551234567",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3100/v1/conversations");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe(
      "Bearer service-token",
    );
    expect(JSON.parse(init.body as string)).toEqual({
      tenantId: "t1",
      businessId: "b1",
      callId: "call-1",
      callerAni: "+15551234567",
    });
  });

  it("throws ConversationAlreadyStartedError on a 409 from startConversation, without retrying", async () => {
    fetchMock.mockResolvedValueOnce(textResponse(409, "already exists"));
    const client = buildClient();

    await expect(
      client.startConversation({
        tenantId: "t1",
        businessId: "b1",
        callId: "call-1",
        callerAni: "+15551234567",
      }),
    ).rejects.toThrow(ConversationAlreadyStartedError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  describe("sendTurn — idempotency-key retry safety (docs/24 §2.2)", () => {
    it("reuses the IDENTICAL idempotencyKey across a retry after a 500", async () => {
      fetchMock
        .mockResolvedValueOnce(textResponse(500, "transient failure"))
        .mockResolvedValueOnce(
          jsonResponse(200, {
            conversationId: "conv-1",
            responseText: "hi",
            toolCallsExecuted: [],
            interrupted: false,
            state: "qualifying",
            transferTargets: null,
          }),
        );
      const client = buildClient();

      const result = await client.sendTurn("conv-1", {
        tenantId: "t1",
        idempotencyKey: "attempt-key-1",
        transcript: "hello",
        allowedTools: ["searchCustomer"],
      });

      expect(result.responseText).toBe("hi");
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const firstBody = JSON.parse(
        (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string,
      );
      const secondBody = JSON.parse(
        (fetchMock.mock.calls[1] as [string, RequestInit])[1].body as string,
      );
      expect(firstBody.idempotencyKey).toBe("attempt-key-1");
      expect(secondBody.idempotencyKey).toBe("attempt-key-1");
    });

    it("retries a 409 (TurnAlreadyInFlight) rather than treating it as fatal", async () => {
      fetchMock
        .mockResolvedValueOnce(textResponse(409, "already in flight"))
        .mockResolvedValueOnce(
          jsonResponse(200, {
            conversationId: "conv-1",
            responseText: "cached result",
            toolCallsExecuted: [],
            interrupted: false,
            state: "qualifying",
            transferTargets: null,
          }),
        );
      const client = buildClient();

      const result = await client.sendTurn("conv-1", {
        tenantId: "t1",
        idempotencyKey: "attempt-key-2",
        transcript: "hello",
        allowedTools: ["searchCustomer"],
      });

      expect(result.responseText).toBe("cached result");
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("does NOT retry a 400 (validation error) — fails immediately", async () => {
      fetchMock.mockResolvedValueOnce(textResponse(400, "bad request"));
      const client = buildClient();

      await expect(
        client.sendTurn("conv-1", {
          tenantId: "t1",
          idempotencyKey: "attempt-key-3",
          transcript: "hello",
          allowedTools: [],
        }),
      ).rejects.toThrow(OrchestratorHttpError);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("does NOT retry a 404 (unknown conversation) — fails immediately", async () => {
      fetchMock.mockResolvedValueOnce(textResponse(404, "not found"));
      const client = buildClient();

      await expect(
        client.sendTurn("missing-conv", {
          tenantId: "t1",
          idempotencyKey: "attempt-key-4",
          transcript: "hello",
          allowedTools: [],
        }),
      ).rejects.toThrow(OrchestratorHttpError);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("propagates an AbortError immediately without retrying when the signal is already aborted", async () => {
      const client = buildClient();
      const controller = new AbortController();
      controller.abort();

      await expect(
        client.sendTurn(
          "conv-1",
          {
            tenantId: "t1",
            idempotencyKey: "attempt-key-5",
            transcript: "hello",
            allowedTools: [],
          },
          controller.signal,
        ),
      ).rejects.toThrow("aborted");
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("gives up after exhausting retries and surfaces the last error", async () => {
      fetchMock.mockResolvedValue(textResponse(503, "still down"));
      const client = buildClient();

      await expect(
        client.sendTurn("conv-1", {
          tenantId: "t1",
          idempotencyKey: "attempt-key-6",
          transcript: "hello",
          allowedTools: [],
        }),
      ).rejects.toThrow(OrchestratorHttpError);
      // DEFAULT_RETRY.maxAttempts = 4 — every attempt used the same key.
      expect(fetchMock).toHaveBeenCalledTimes(4);
      const bodies = fetchMock.mock.calls.map(
        (call) => JSON.parse((call as [string, RequestInit])[1].body as string).idempotencyKey,
      );
      expect(new Set(bodies).size).toBe(1);
    });
  });

  describe("findByCallId", () => {
    it("returns null on a 404 instead of throwing", async () => {
      fetchMock.mockResolvedValueOnce(textResponse(404, "not found"));
      const client = buildClient();

      const result = await client.findByCallId("t1", "call-1");

      expect(result).toBeNull();
    });

    it("returns the conversation when found", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(200, { id: "conv-1", tenantId: "t1", callId: "call-1" }),
      );
      const client = buildClient();

      const result = await client.findByCallId("t1", "call-1");

      expect(result?.id).toBe("conv-1");
    });
  });
});
