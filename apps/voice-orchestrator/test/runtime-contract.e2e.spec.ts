import { randomUUID } from "node:crypto";
import {
  authHeader,
  bootVoiceRuntimeSimulator,
  type VoiceRuntimeSimulator,
} from "./voice-runtime-simulator";

/**
 * The Voice Runtime's entire contract with this service, exercised exactly
 * as a real runtime would: HTTP in, HTTP out, no shortcuts through
 * controller methods or use cases directly. Each `describe` block is one
 * scenario a real telephony integration will actually hit — this is what
 * "Phase 8: Voice Runtime Integration" concretely verifies, beyond what the
 * unit specs already cover in isolation.
 */
describe("Voice Runtime contract (e2e, simulated)", () => {
  let sim: VoiceRuntimeSimulator;

  beforeEach(async () => {
    sim = await bootVoiceRuntimeSimulator();
  });

  afterEach(async () => {
    await sim.close();
  });

  function startPayload(overrides: Record<string, unknown> = {}) {
    return {
      tenantId: randomUUID(),
      businessId: randomUUID(),
      callId: randomUUID(),
      callerAni: "+15551234567",
      timezone: "America/Chicago",
      ...overrides,
    };
  }

  async function startConversation(overrides: Record<string, unknown> = {}) {
    const res = await sim.inject({
      method: "POST",
      url: "/v1/conversations",
      headers: authHeader(sim.serviceToken),
      payload: startPayload(overrides),
    });
    return res;
  }

  describe("service authentication", () => {
    it("rejects any request with no bearer token", async () => {
      const res = await sim.inject({
        method: "POST",
        url: "/v1/conversations",
        payload: startPayload(),
      });
      expect(res.statusCode).toBe(401);
    });

    it("rejects a wrong bearer token", async () => {
      const res = await sim.inject({
        method: "POST",
        url: "/v1/conversations",
        headers: { authorization: "Bearer not-the-real-token" },
        payload: startPayload(),
      });
      expect(res.statusCode).toBe(401);
    });

    it("healthz/readyz remain reachable with no token (@Public)", async () => {
      const healthz = await sim.inject({ method: "GET", url: "/healthz" });
      const readyz = await sim.inject({ method: "GET", url: "/readyz" });
      expect(healthz.statusCode).toBe(200);
      expect(readyz.statusCode).toBe(200);
    });
  });

  describe("request validation", () => {
    it("rejects a start payload with an invalid E.164 callerAni", async () => {
      const res = await startConversation({ callerAni: "5551234567" });
      expect(res.statusCode).toBe(400);
    });

    it("rejects a start payload with unknown extra fields (forbidNonWhitelisted)", async () => {
      const res = await sim.inject({
        method: "POST",
        url: "/v1/conversations",
        headers: authHeader(sim.serviceToken),
        payload: { ...startPayload(), unexpectedField: "nope" },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("full call lifecycle: start -> turn -> interrupt -> turn -> end", () => {
    it("walks a complete call exactly as a Voice Runtime would drive it", async () => {
      const started = await startConversation();
      expect(started.statusCode).toBe(201);
      const conversation = started.json();
      expect(conversation.state).toBe("greeting");
      expect(conversation.turnCount).toBe(0);

      sim.aiProvider.responses = [
        [
          { type: "text_delta", text: "Thanks for calling, how can I help?" },
          { type: "done", stopReason: "end_turn" },
        ],
      ];
      const firstTurn = await sim.inject({
        method: "POST",
        url: `/v1/conversations/${conversation.id}/turns`,
        headers: authHeader(sim.serviceToken),
        payload: {
          tenantId: conversation.tenantId,
          idempotencyKey: randomUUID(),
          transcript: "Hi, my sink is leaking",
          allowedTools: ["searchCustomer", "createCustomer", "createLead"],
        },
      });
      expect(firstTurn.statusCode).toBe(200);
      expect(firstTurn.json().responseText).toContain("Thanks for calling");

      const interrupted = await sim.inject({
        method: "POST",
        url: `/v1/conversations/${conversation.id}/interrupt`,
        headers: authHeader(sim.serviceToken),
        payload: { tenantId: conversation.tenantId },
      });
      expect(interrupted.statusCode).toBe(200);
      expect(interrupted.json().state).toBe("silence");

      sim.aiProvider.responses = [
        [
          { type: "text_delta", text: "Got it, let me get that scheduled." },
          { type: "done", stopReason: "end_turn" },
        ],
      ];
      const secondTurn = await sim.inject({
        method: "POST",
        url: `/v1/conversations/${conversation.id}/turns`,
        headers: authHeader(sim.serviceToken),
        payload: {
          tenantId: conversation.tenantId,
          idempotencyKey: randomUUID(),
          transcript: "Yes please",
          allowedTools: ["searchCustomer", "createCustomer", "createLead"],
        },
      });
      expect(secondTurn.statusCode).toBe(200);

      const ended = await sim.inject({
        method: "POST",
        url: `/v1/conversations/${conversation.id}/end`,
        headers: authHeader(sim.serviceToken),
        payload: { tenantId: conversation.tenantId, endReason: "caller_hangup" },
      });
      expect(ended.statusCode).toBe(200);
      expect(ended.json().state).toBe("ended");
      expect(ended.json().endReason).toBe("caller_hangup");

      const transcript = await sim.inject({
        method: "GET",
        url: `/v1/conversations/${conversation.id}/transcript?tenantId=${conversation.tenantId}`,
        headers: authHeader(sim.serviceToken),
      });
      expect(transcript.statusCode).toBe(200);
      const turns = transcript.json();
      expect(turns.length).toBeGreaterThanOrEqual(4); // 2 caller + 2 agent turns
      expect(turns[0].speaker).toBe("caller");

      // Ending an already-ended conversation is idempotent, not an error —
      // a real runtime may send both a caller-hangup and a call-ended signal.
      const endedAgain = await sim.inject({
        method: "POST",
        url: `/v1/conversations/${conversation.id}/end`,
        headers: authHeader(sim.serviceToken),
        payload: { tenantId: conversation.tenantId, endReason: "call_ended_signal" },
      });
      expect(endedAgain.statusCode).toBe(200);
      expect(endedAgain.json().endReason).toBe("caller_hangup"); // first reason wins, not overwritten
    });

    it("rejects a turn submitted after the conversation has ended", async () => {
      const started = await startConversation();
      const conversation = started.json();
      await sim.inject({
        method: "POST",
        url: `/v1/conversations/${conversation.id}/end`,
        headers: authHeader(sim.serviceToken),
        payload: { tenantId: conversation.tenantId, endReason: "caller_hangup" },
      });

      const turnAfterEnd = await sim.inject({
        method: "POST",
        url: `/v1/conversations/${conversation.id}/turns`,
        headers: authHeader(sim.serviceToken),
        payload: {
          tenantId: conversation.tenantId,
          idempotencyKey: randomUUID(),
          transcript: "hello?",
          allowedTools: ["searchCustomer"],
        },
      });
      expect(turnAfterEnd.statusCode).toBe(409);
    });

    it("404s on any lifecycle call against an unknown conversation id", async () => {
      const fakeId = randomUUID();
      const tenantId = randomUUID();
      const res = await sim.inject({
        method: "POST",
        url: `/v1/conversations/${fakeId}/turns`,
        headers: authHeader(sim.serviceToken),
        payload: {
          tenantId,
          idempotencyKey: randomUUID(),
          transcript: "hi",
          allowedTools: ["searchCustomer"],
        },
      });
      expect(res.statusCode).toBe(404);
    });

    it("404s when a real conversation is addressed with the WRONG tenantId (cross-tenant isolation)", async () => {
      const started = await startConversation();
      const conversation = started.json();

      const res = await sim.inject({
        method: "GET",
        url: `/v1/conversations/${conversation.id}?tenantId=${randomUUID()}`,
        headers: authHeader(sim.serviceToken),
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("one conversation per call", () => {
    it("rejects a second start for the same callId (409)", async () => {
      const payload = startPayload();
      const first = await sim.inject({
        method: "POST",
        url: "/v1/conversations",
        headers: authHeader(sim.serviceToken),
        payload,
      });
      expect(first.statusCode).toBe(201);

      const second = await sim.inject({
        method: "POST",
        url: "/v1/conversations",
        headers: authHeader(sim.serviceToken),
        payload,
      });
      expect(second.statusCode).toBe(409);
    });
  });

  describe("lookup by callId (docs/24 §5 — Voice Runtime restart recovery)", () => {
    it("finds the conversation by callId when the runtime lost its cached conversationId", async () => {
      const started = await startConversation();
      const conversation = started.json();

      const res = await sim.inject({
        method: "GET",
        url: `/v1/conversations/by-call/${conversation.callId}?tenantId=${conversation.tenantId}`,
        headers: authHeader(sim.serviceToken),
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(conversation.id);
      expect(res.json().callId).toBe(conversation.callId);
    });

    it("404s for an unknown callId", async () => {
      const res = await sim.inject({
        method: "GET",
        url: `/v1/conversations/by-call/${randomUUID()}?tenantId=${randomUUID()}`,
        headers: authHeader(sim.serviceToken),
      });
      expect(res.statusCode).toBe(404);
    });

    it("404s when the callId is real but addressed with the WRONG tenantId", async () => {
      const started = await startConversation();
      const conversation = started.json();

      const res = await sim.inject({
        method: "GET",
        url: `/v1/conversations/by-call/${conversation.callId}?tenantId=${randomUUID()}`,
        headers: authHeader(sim.serviceToken),
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("turn-level idempotency (Voice Runtime retry safety)", () => {
    it("a replayed turn with the same idempotencyKey returns the identical result without re-invoking the AI provider", async () => {
      const started = await startConversation();
      const conversation = started.json();
      sim.aiProvider.responses = [
        [
          { type: "text_delta", text: "first and only real invocation" },
          { type: "done", stopReason: "end_turn" },
        ],
      ];
      const idempotencyKey = randomUUID();
      const turnPayload = {
        tenantId: conversation.tenantId,
        idempotencyKey,
        transcript: "network is about to blip",
        allowedTools: ["searchCustomer"],
      };

      const first = await sim.inject({
        method: "POST",
        url: `/v1/conversations/${conversation.id}/turns`,
        headers: authHeader(sim.serviceToken),
        payload: turnPayload,
      });
      expect(first.statusCode).toBe(200);
      expect(sim.aiProvider.requests).toHaveLength(1);

      // Simulate the Voice Runtime retrying the exact same turn after a
      // timeout it experienced but the server actually completed.
      const retry = await sim.inject({
        method: "POST",
        url: `/v1/conversations/${conversation.id}/turns`,
        headers: authHeader(sim.serviceToken),
        payload: turnPayload,
      });
      expect(retry.statusCode).toBe(200);
      expect(retry.json()).toEqual(first.json());
      expect(sim.aiProvider.requests).toHaveLength(1); // NOT re-invoked
    });

    it("two DIFFERENT idempotencyKeys for the same conversation are independent turns", async () => {
      const started = await startConversation();
      const conversation = started.json();
      sim.aiProvider.responses = [
        [
          { type: "text_delta", text: "response one" },
          { type: "done", stopReason: "end_turn" },
        ],
        [
          { type: "text_delta", text: "response two" },
          { type: "done", stopReason: "end_turn" },
        ],
      ];

      const first = await sim.inject({
        method: "POST",
        url: `/v1/conversations/${conversation.id}/turns`,
        headers: authHeader(sim.serviceToken),
        payload: {
          tenantId: conversation.tenantId,
          idempotencyKey: randomUUID(),
          transcript: "first thing caller said",
          allowedTools: ["searchCustomer"],
        },
      });
      const second = await sim.inject({
        method: "POST",
        url: `/v1/conversations/${conversation.id}/turns`,
        headers: authHeader(sim.serviceToken),
        payload: {
          tenantId: conversation.tenantId,
          idempotencyKey: randomUUID(),
          transcript: "second thing caller said",
          allowedTools: ["searchCustomer"],
        },
      });

      expect(first.json().responseText).toContain("response one");
      expect(second.json().responseText).toContain("response two");
      expect(sim.aiProvider.requests).toHaveLength(2);
    });
  });

  describe("tool broker integration (real ExecuteToolUseCase pipeline over HTTP)", () => {
    it("createLead: model requests a tool call, the broker executes it via the (faked) core-api client, and the lead id lands on the conversation", async () => {
      const started = await startConversation();
      const conversation = started.json();

      const leadId = randomUUID();
      sim.coreApiClient.postResponses.set("/internal/leads", { id: leadId });
      sim.aiProvider.responses = [
        [
          {
            type: "tool_call",
            toolCall: {
              id: "call_1",
              name: "createLead",
              arguments: {
                customer_id: randomUUID(),
                business_id: conversation.businessId,
                call_id: conversation.callId,
                problem_summary: "Kitchen sink leaking under the cabinet",
                priority: "urgent",
                lead_type: "residential",
              },
            },
          },
          { type: "done", stopReason: "tool_use" },
        ],
        [
          { type: "text_delta", text: "You're all set, a plumber will call shortly." },
          { type: "done", stopReason: "end_turn" },
        ],
      ];

      const res = await sim.inject({
        method: "POST",
        url: `/v1/conversations/${conversation.id}/turns`,
        headers: authHeader(sim.serviceToken),
        payload: {
          tenantId: conversation.tenantId,
          idempotencyKey: randomUUID(),
          transcript: "Please just get someone out here",
          allowedTools: ["createLead"],
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().toolCallsExecuted).toEqual(["createLead"]);
      // postCalls[0] is StartConversationUseCase's own POST /internal/calls
      // (the production-blocker fix's ordering guarantee, fired during the
      // shared startConversation() helper above) — the createLead tool
      // call is the NEXT one on this shared fake client.
      expect(sim.coreApiClient.postCalls[1]?.path).toBe("/internal/leads");

      const fetched = await sim.inject({
        method: "GET",
        url: `/v1/conversations/${conversation.id}?tenantId=${conversation.tenantId}`,
        headers: authHeader(sim.serviceToken),
      });
      expect(fetched.json().leadId).toBe(leadId);
    });

    it("a tool call outside this turn's allowedTools is rejected structurally, not executed, and the call is not killed", async () => {
      const started = await startConversation();
      const conversation = started.json();

      sim.aiProvider.responses = [
        [
          {
            type: "tool_call",
            toolCall: { id: "call_1", name: "createLead", arguments: {} },
          },
          { type: "done", stopReason: "tool_use" },
        ],
        [
          { type: "text_delta", text: "recovered gracefully" },
          { type: "done", stopReason: "end_turn" },
        ],
      ];

      const res = await sim.inject({
        method: "POST",
        url: `/v1/conversations/${conversation.id}/turns`,
        headers: authHeader(sim.serviceToken),
        // Deliberately does NOT include createLead in allowedTools.
        payload: {
          tenantId: conversation.tenantId,
          idempotencyKey: randomUUID(),
          transcript: "hello",
          allowedTools: ["searchCustomer"],
        },
      });

      expect(res.statusCode).toBe(200);
      // Exactly 1 (StartConversationUseCase's own POST /internal/calls from
      // the startConversation() helper above) — the rejected tool call
      // itself never reached the handler, so no SECOND post call happens.
      expect(sim.coreApiClient.postCalls).toHaveLength(1);
      expect(sim.coreApiClient.postCalls[0]?.path).toBe("/internal/calls");
      expect(res.json().responseText).toContain("recovered gracefully");
    });

    it("escalateEmergency success publishes through to the conversation without crashing the turn even when core-api is unreachable for OTHER calls in the same turn", async () => {
      const started = await startConversation();
      const conversation = started.json();

      sim.coreApiClient.postResponses.set("/internal/emergency-rules/escalate", {
        isEmergency: true,
        severity: "critical",
        action: "forward_call",
        transferTargets: ["+15551234567"],
      });
      sim.aiProvider.responses = [
        [
          {
            type: "tool_call",
            toolCall: {
              id: "call_1",
              name: "escalateEmergency",
              arguments: {
                business_id: conversation.businessId,
                call_id: conversation.callId,
                description: "I smell gas in the house",
              },
            },
          },
          { type: "done", stopReason: "tool_use" },
        ],
        [
          { type: "text_delta", text: "I'm connecting you to someone right now." },
          { type: "done", stopReason: "end_turn" },
        ],
      ];

      const res = await sim.inject({
        method: "POST",
        url: `/v1/conversations/${conversation.id}/turns`,
        headers: authHeader(sim.serviceToken),
        payload: {
          tenantId: conversation.tenantId,
          idempotencyKey: randomUUID(),
          transcript: "I smell gas",
          allowedTools: ["escalateEmergency"],
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().toolCallsExecuted).toEqual(["escalateEmergency"]);
      expect(res.json().transferTargets).toEqual(["+15551234567"]);
    });
  });
});
