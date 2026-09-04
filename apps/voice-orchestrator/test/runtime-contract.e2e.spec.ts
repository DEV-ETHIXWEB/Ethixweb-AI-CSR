import { randomUUID } from "node:crypto";
import {
  authHeader,
  bootVoiceRuntimeSimulator,
  parseTurnResult,
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

  /**
   * Call-start now also runs one non-tool completion for the opening
   * greeting (StartConversationUseCase.generateGreeting) — real,
   * necessary infrastructure to get a valid conversation into existence,
   * but not what any test in this file is actually testing about the
   * turns that follow. Resetting the fake right after a successful start
   * keeps every existing test's assumption intact: `responses[0]` is
   * still "the first turn I'm testing," and N turns made still means N
   * requests recorded, exactly as before this feature existed.
   */
  async function startConversation(overrides: Record<string, unknown> = {}) {
    const res = await sim.inject({
      method: "POST",
      url: "/v1/conversations",
      headers: authHeader(sim.serviceToken),
      payload: startPayload(overrides),
    });
    if (res.statusCode === 201) {
      sim.aiProvider.reset();
    }
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
      expect(parseTurnResult(firstTurn)["responseText"]).toContain("Thanks for calling");
      // Regression coverage for a real live-call failure: a keep-alive
      // connection reused across several turns on the same call got
      // into a state where a LATER turn's response never reached the
      // client at all, even though this endpoint completed normally
      // server-side — the caller heard total silence. Forcing a fresh
      // connection per turn (docs/28 §C.3) removes that reuse path
      // entirely; this asserts the header that makes that happen is
      // actually present, not just present in intent.
      expect(firstTurn.headers["connection"]).toBe("close");

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
      expect(parseTurnResult(retry)).toEqual(parseTurnResult(first));
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

      expect(parseTurnResult(first)["responseText"]).toContain("response one");
      expect(parseTurnResult(second)["responseText"]).toContain("response two");
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
      expect(parseTurnResult(res)["toolCallsExecuted"]).toEqual(["createLead"]);
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
      expect(parseTurnResult(res)["responseText"]).toContain("recovered gracefully");
    });

    it("escalateEmergency success publishes through to the conversation without crashing the turn even when core-api is unreachable for OTHER calls in the same turn", async () => {
      const started = await startConversation();
      const conversation = started.json();

      sim.coreApiClient.postResponses.set("/internal/emergency-rules/escalate", {
        isEmergency: true,
        severity: "critical",
        action: "forward_call",
        transferDestination: "+15551234567",
      });
      sim.aiProvider.responses = [
        [
          {
            type: "tool_call",
            toolCall: {
              id: "call_1",
              name: "escalateEmergency",
              arguments: {
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
      const escalationResult = parseTurnResult(res);
      expect(escalationResult["toolCallsExecuted"]).toEqual(["escalateEmergency"]);
      expect(escalationResult["escalation"]).toEqual({
        severity: "critical",
        action: "forward_call",
        transferDestination: "+15551234567",
      });
    });
  });

  describe("Phase 10: concurrency guarantees a real telephony retry storm can trigger", () => {
    it("CONCURRENT DUPLICATE CALL START: two simultaneous POST /conversations for the SAME callId never both succeed — exactly one 201, the rest 409", async () => {
      const payload = startPayload();

      const [first, second] = await Promise.all([
        sim.inject({
          method: "POST",
          url: "/v1/conversations",
          headers: authHeader(sim.serviceToken),
          payload,
        }),
        sim.inject({
          method: "POST",
          url: "/v1/conversations",
          headers: authHeader(sim.serviceToken),
          payload,
        }),
      ]);

      const statuses = [first.statusCode, second.statusCode].sort();
      expect(statuses).toEqual([201, 409]);
    });

    it("CONCURRENT DUPLICATE TURN: two simultaneous turns with the SAME idempotencyKey never both invoke the LLM — one wins, the other sees the in-flight conflict or the identical cached result", async () => {
      const started = await startConversation();
      const conversation = started.json();
      sim.aiProvider.responses = [
        [
          { type: "text_delta", text: "only one real invocation" },
          { type: "done", stopReason: "end_turn" },
        ],
      ];
      const idempotencyKey = randomUUID();
      const turnPayload = {
        tenantId: conversation.tenantId,
        idempotencyKey,
        transcript: "concurrent retry storm",
        allowedTools: ["searchCustomer"],
      };

      const [first, second] = await Promise.all([
        sim.inject({
          method: "POST",
          url: `/v1/conversations/${conversation.id}/turns`,
          headers: authHeader(sim.serviceToken),
          payload: turnPayload,
        }),
        sim.inject({
          method: "POST",
          url: `/v1/conversations/${conversation.id}/turns`,
          headers: authHeader(sim.serviceToken),
          payload: turnPayload,
        }),
      ]);

      // Either both succeed with the IDENTICAL cached result, or one 409s
      // as in-flight — the AI provider is the only thing that must never
      // be double-invoked. Both outcomes are correct per docs/24 §2.2.
      const statuses = [first.statusCode, second.statusCode];
      expect(statuses.every((s) => s === 200 || s === 409)).toBe(true);
      if (first.statusCode === 200 && second.statusCode === 200) {
        expect(parseTurnResult(first)).toEqual(parseTurnResult(second));
      }
      expect(sim.aiProvider.requests).toHaveLength(1);
    });
  });

  describe("Phase 10: core-api outage does not crash a live call", () => {
    it("a core-api outage during a tool call degrades the turn gracefully — the HTTP request to the runtime still succeeds", async () => {
      const started = await startConversation();
      const conversation = started.json();
      sim.coreApiClient.failWith = new Error("core-api unreachable (simulated outage)");
      sim.aiProvider.responses = [
        [
          {
            type: "tool_call",
            toolCall: {
              id: "call_1",
              name: "searchCustomer",
              arguments: { phone: "+15551234567", business_id: conversation.businessId },
            },
          },
          { type: "done", stopReason: "tool_use" },
        ],
        [
          { type: "text_delta", text: "Let me get someone to call you back." },
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
          transcript: "hi",
          allowedTools: ["searchCustomer"],
        },
      });

      // The call never crashes — the runtime still gets a 200 with SOME
      // spoken response, even though the tool call itself degraded.
      expect(res.statusCode).toBe(200);
      expect(typeof parseTurnResult(res)["responseText"]).toBe("string");
    });

    it("core-api being unreachable at call-start correctly FAILS conversation start (the FK ordering guarantee cannot be silently skipped)", async () => {
      sim.coreApiClient.failWith = new Error("core-api unreachable (simulated outage)");

      const res = await sim.inject({
        method: "POST",
        url: "/v1/conversations",
        headers: authHeader(sim.serviceToken),
        payload: startPayload(),
      });

      // NOT 201 — StartConversationUseCase's own ordering guarantee means
      // a Call-creation failure must fail conversation start too, never
      // silently proceed into a conversation no Call row backs.
      expect(res.statusCode).not.toBe(201);
    });
  });

  describe("Phase 10: early hangup", () => {
    it("caller hangs up before qualification completes — the conversation ends cleanly with no lead, no crash", async () => {
      const started = await startConversation();
      const conversation = started.json();

      const ended = await sim.inject({
        method: "POST",
        url: `/v1/conversations/${conversation.id}/end`,
        headers: authHeader(sim.serviceToken),
        payload: { tenantId: conversation.tenantId, endReason: "caller_hangup_early" },
      });

      expect(ended.statusCode).toBe(200);
      expect(ended.json().state).toBe("ended");

      const fetched = await sim.inject({
        method: "GET",
        url: `/v1/conversations/${conversation.id}?tenantId=${conversation.tenantId}`,
        headers: authHeader(sim.serviceToken),
      });
      expect(fetched.json().leadId).toBeNull();
    });

    it("caller hangs up AFTER lead creation — the lead is preserved, never lost, and the Call is closed as completed not abandoned", async () => {
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
                problem_summary: "Burst pipe in the basement",
                priority: "emergency",
                lead_type: "residential",
              },
            },
          },
          { type: "done", stopReason: "tool_use" },
        ],
        [
          { type: "text_delta", text: "Someone will call you right back." },
          { type: "done", stopReason: "end_turn" },
        ],
      ];
      await sim.inject({
        method: "POST",
        url: `/v1/conversations/${conversation.id}/turns`,
        headers: authHeader(sim.serviceToken),
        payload: {
          tenantId: conversation.tenantId,
          idempotencyKey: randomUUID(),
          transcript: "my basement is flooding",
          allowedTools: ["createLead"],
        },
      });

      const ended = await sim.inject({
        method: "POST",
        url: `/v1/conversations/${conversation.id}/end`,
        headers: authHeader(sim.serviceToken),
        payload: { tenantId: conversation.tenantId, endReason: "caller_hangup" },
      });
      expect(ended.statusCode).toBe(200);

      const fetched = await sim.inject({
        method: "GET",
        url: `/v1/conversations/${conversation.id}?tenantId=${conversation.tenantId}`,
        headers: authHeader(sim.serviceToken),
      });
      expect(fetched.json().leadId).toBe(leadId); // never lost

      const callEndCall = sim.coreApiClient.postCalls.find((c) => c.path.includes("/end"));
      expect(callEndCall?.body).toMatchObject({ status: "completed" });
    });
  });

  describe("Phase 10: no scheduling capability is reachable from the runtime path", () => {
    it("the tool catalog exposed to a real conversation never includes any scheduling/dispatch/booking tool, no matter what allowedTools the caller requests", async () => {
      const started = await startConversation();
      const conversation = started.json();

      // A hostile/buggy caller requesting every plausible scheduling-tool
      // name — none of them are registered, so the broker can only ever
      // reject them structurally (ToolNotFoundError), never execute one.
      // NOTE on `toolCallsExecuted`: it records every tool the MODEL
      // requested this turn (HandleTurnUseCase pushes the name before
      // attempting execution), not only tools that actually ran — so a
      // rejected name still appears there. The real guarantee this test
      // proves is stronger and more direct: no HTTP call was ever made to
      // core-api on behalf of this "tool," because ExecuteToolUseCase's
      // stage-1 registry lookup fails closed before any handler exists to
      // call anything — see the postCalls assertion below.
      sim.aiProvider.responses = [
        [
          {
            type: "tool_call",
            toolCall: { id: "call_1", name: "scheduleAppointment", arguments: {} },
          },
          { type: "done", stopReason: "tool_use" },
        ],
        [
          { type: "text_delta", text: "recovered — no scheduling tool exists" },
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
          // Even naming it explicitly in allowedTools can't make it exist —
          // stage 1 of ExecuteToolUseCase (registry lookup) fails closed
          // before authorization is ever checked.
          transcript: "can you schedule me for 3pm tomorrow",
          allowedTools: ["scheduleAppointment", "bookTechnician", "createJob", "dispatchTech"],
        },
      });

      expect(res.statusCode).toBe(200);
      expect(parseTurnResult(res)["responseText"]).toContain("no scheduling tool exists");
      // The real proof of no-scheduling-capability: exactly one core-api
      // call happened this whole turn (StartConversationUseCase's own
      // POST /internal/calls from startConversation() above) — the
      // rejected "scheduleAppointment" request never reached core-api at
      // all, because no handler for it exists to call anything with.
      expect(sim.coreApiClient.postCalls).toHaveLength(1);
      expect(sim.coreApiClient.postCalls[0]?.path).toBe("/internal/calls");
    });
  });

  describe("Phase 10: correlation ID propagation", () => {
    it("callId flows unchanged from conversation start through to every core-api call made on that call's behalf", async () => {
      const callId = randomUUID();
      const started = await startConversation({ callId });
      const conversation = started.json();
      expect(conversation.callId).toBe(callId);

      sim.coreApiClient.postResponses.set("/internal/leads", { id: randomUUID() });
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
                call_id: callId,
                problem_summary: "test",
                priority: "routine",
                lead_type: "residential",
              },
            },
          },
          { type: "done", stopReason: "tool_use" },
        ],
        [
          { type: "text_delta", text: "done" },
          { type: "done", stopReason: "end_turn" },
        ],
      ];
      await sim.inject({
        method: "POST",
        url: `/v1/conversations/${conversation.id}/turns`,
        headers: authHeader(sim.serviceToken),
        payload: {
          tenantId: conversation.tenantId,
          idempotencyKey: randomUUID(),
          transcript: "test",
          allowedTools: ["createLead"],
        },
      });
      await sim.inject({
        method: "POST",
        url: `/v1/conversations/${conversation.id}/end`,
        headers: authHeader(sim.serviceToken),
        payload: { tenantId: conversation.tenantId, endReason: "caller_hangup" },
      });

      // Every single core-api call this call ever generated carries the
      // SAME callId somewhere in its path or body — the one stable thread
      // that lets telephonyCallSid -> Call -> Conversation -> Lead all be
      // reconstructed from logs/traces alone.
      const startCallBody = sim.coreApiClient.postCalls[0]?.body as { telephonyCallSid?: string };
      const leadBody = sim.coreApiClient.postCalls[1]?.body as { callId?: string };
      const usageBody = sim.coreApiClient.postCalls.find((c) => c.path === "/internal/usage")
        ?.body as { callId?: string };
      const endCallPath = sim.coreApiClient.postCalls.find((c) => c.path.includes("/end"))?.path;

      expect(startCallBody.telephonyCallSid).toBe(callId);
      expect(leadBody.callId).toBe(callId);
      expect(usageBody?.callId).toBe(callId);
      expect(endCallPath).toBe(`/internal/calls/by-telephony-sid/${callId}/end`);
    });
  });

  describe("Phase 10: usage metering", () => {
    it("ending a conversation emits a voice_call_duration usage event to core-api", async () => {
      const started = await startConversation();
      const conversation = started.json();

      await sim.inject({
        method: "POST",
        url: `/v1/conversations/${conversation.id}/end`,
        headers: authHeader(sim.serviceToken),
        payload: { tenantId: conversation.tenantId, endReason: "caller_hangup" },
      });

      const usageCall = sim.coreApiClient.postCalls.find((c) => c.path === "/internal/usage");
      expect(usageCall).toBeDefined();
      expect(usageCall?.body).toMatchObject({
        usageType: "voice_call_duration",
        unit: "seconds",
        source: "voice-orchestrator",
      });
    });
  });

  describe("Docs/36: capacity, overload, and branded waiting", () => {
    // These are BEHAVIORAL/CONCURRENCY tests, not a claim about real
    // production capacity numbers — this environment has no live
    // Twilio/LiveKit/STT/TTS/LLM to measure real vendor throughput
    // against (see docs/29/docs/36's own honest accounting). What IS
    // proven here: many calls admitted under the configured ceiling truly
    // run independently (no shared/leaked state), and the ceiling itself
    // is actually enforced, not merely configured.

    async function startNCallsConcurrently(n: number) {
      const payloads = Array.from({ length: n }, () => startPayload());
      const responses = await Promise.all(
        payloads.map((payload) =>
          sim.inject({
            method: "POST",
            url: "/v1/conversations",
            headers: authHeader(sim.serviceToken),
            payload,
          }),
        ),
      );
      return { payloads, responses };
    }

    it.each([1, 5, 10])(
      "%i concurrent calls (different tenants, within the default ceiling) are ALL admitted with independent conversations",
      async (n) => {
        const { responses } = await startNCallsConcurrently(n);
        const statuses = responses.map((r) => r.statusCode);
        expect(statuses.every((s) => s === 201)).toBe(true);

        const conversationIds = new Set(responses.map((r) => r.json().id as string));
        // No two calls collapsed into the same conversation — proves no
        // cross-call state sharing under real concurrency.
        expect(conversationIds.size).toBe(n);
      },
    );

    it("25 concurrent calls across different tenants each get their own isolated conversation, tenant, and callId — no cross-call leakage", async () => {
      const { payloads, responses } = await startNCallsConcurrently(25);
      expect(responses.every((r) => r.statusCode === 201)).toBe(true);

      const bodies = responses.map((r) => r.json());
      for (let i = 0; i < payloads.length; i++) {
        expect(bodies[i]?.tenantId).toBe(payloads[i]?.tenantId);
        expect(bodies[i]?.callId).toBe(payloads[i]?.callId);
      }
      // Every tenantId is unique in this test (startPayload() generates a
      // fresh UUID per call), so 25 distinct conversations is the
      // correct, expected count — not an approximation.
      const conversationIds = new Set(bodies.map((b) => b.id as string));
      expect(conversationIds.size).toBe(25);
    });

    it("50 concurrent calls under the default global ceiling (100) are all admitted, each producing exactly one Call-creation POST to core-api — no duplicate/merged calls", async () => {
      const { responses } = await startNCallsConcurrently(50);
      expect(responses.every((r) => r.statusCode === 201)).toBe(true);
      expect(sim.coreApiClient.postCalls.filter((c) => c.path === "/internal/calls")).toHaveLength(
        50,
      );
    });

    it("enforces MAX_TENANT_CONCURRENT_CALLS for NORMAL calls: with a ceiling of 3 and the default 20% emergency headroom, only 2 normal calls are admitted (floor(3 * 0.8) = 2) before the 3rd is rejected with 429", async () => {
      // The 3rd slot is deliberately reserved as emergency headroom (see
      // RedisCallAdmissionAdapter's own comment) — a normal call cannot
      // consume it, only an isEmergencyPriority:true call can (covered by
      // the "emergency-priority call can be admitted into the headroom
      // band" test below). This IS the intended behavior, not a bug: it's
      // the whole point of reserving headroom.
      const originalLimit = process.env["MAX_TENANT_CONCURRENT_CALLS"];
      process.env["MAX_TENANT_CONCURRENT_CALLS"] = "3";
      try {
        const tenantId = randomUUID();
        const businessId = randomUUID();
        const payloads = Array.from({ length: 4 }, () => startPayload({ tenantId, businessId }));
        const responses = await Promise.all(
          payloads.map((payload) =>
            sim.inject({
              method: "POST",
              url: "/v1/conversations",
              headers: authHeader(sim.serviceToken),
              payload,
            }),
          ),
        );
        const statuses = responses.map((r) => r.statusCode).sort();
        expect(statuses).toEqual([201, 201, 429, 429]);
      } finally {
        if (originalLimit === undefined) {
          delete process.env["MAX_TENANT_CONCURRENT_CALLS"];
        } else {
          process.env["MAX_TENANT_CONCURRENT_CALLS"] = originalLimit;
        }
      }
    });

    it("a 429 response includes Retry-After and a waitingExperience body the runtime can act on immediately, without a second round-trip", async () => {
      const originalLimit = process.env["MAX_TENANT_CONCURRENT_CALLS"];
      process.env["MAX_TENANT_CONCURRENT_CALLS"] = "1";
      try {
        const tenantId = randomUUID();
        const businessId = randomUUID();
        await sim.inject({
          method: "POST",
          url: "/v1/conversations",
          headers: authHeader(sim.serviceToken),
          payload: startPayload({ tenantId, businessId }),
        });
        const rejected = await sim.inject({
          method: "POST",
          url: "/v1/conversations",
          headers: authHeader(sim.serviceToken),
          payload: startPayload({ tenantId, businessId }),
        });

        expect(rejected.statusCode).toBe(429);
        expect(rejected.headers["retry-after"]).toBeDefined();
        const body = rejected.json();
        expect(body.scope).toBe("tenant");
        expect(body).toHaveProperty("waitingExperience");
        expect(body.waitingExperience).toHaveProperty("brochureSegment");
        expect(body.waitingExperience).toHaveProperty("overflowNumber");
      } finally {
        if (originalLimit === undefined) {
          delete process.env["MAX_TENANT_CONCURRENT_CALLS"];
        } else {
          process.env["MAX_TENANT_CONCURRENT_CALLS"] = originalLimit;
        }
      }
    });

    it("a rejected (429) call never reaches core-api at all — capacity is checked before the Call-row creation, matching StartConversationUseCase's own ordering", async () => {
      const originalLimit = process.env["MAX_TENANT_CONCURRENT_CALLS"];
      process.env["MAX_TENANT_CONCURRENT_CALLS"] = "1";
      try {
        const tenantId = randomUUID();
        const businessId = randomUUID();
        await sim.inject({
          method: "POST",
          url: "/v1/conversations",
          headers: authHeader(sim.serviceToken),
          payload: startPayload({ tenantId, businessId }),
        });
        const callsBeforeRejection = sim.coreApiClient.postCalls.length;

        await sim.inject({
          method: "POST",
          url: "/v1/conversations",
          headers: authHeader(sim.serviceToken),
          payload: startPayload({ tenantId, businessId }),
        });

        expect(sim.coreApiClient.postCalls.length).toBe(callsBeforeRejection);
      } finally {
        if (originalLimit === undefined) {
          delete process.env["MAX_TENANT_CONCURRENT_CALLS"];
        } else {
          process.env["MAX_TENANT_CONCURRENT_CALLS"] = originalLimit;
        }
      }
    });

    it("ending a call releases its capacity reservation — a slot freed by one caller's hangup can be reused by the next caller", async () => {
      const originalLimit = process.env["MAX_TENANT_CONCURRENT_CALLS"];
      process.env["MAX_TENANT_CONCURRENT_CALLS"] = "1";
      try {
        const tenantId = randomUUID();
        const businessId = randomUUID();
        const first = await sim.inject({
          method: "POST",
          url: "/v1/conversations",
          headers: authHeader(sim.serviceToken),
          payload: startPayload({ tenantId, businessId }),
        });
        expect(first.statusCode).toBe(201);

        const rejected = await sim.inject({
          method: "POST",
          url: "/v1/conversations",
          headers: authHeader(sim.serviceToken),
          payload: startPayload({ tenantId, businessId }),
        });
        expect(rejected.statusCode).toBe(429);

        await sim.inject({
          method: "POST",
          url: `/v1/conversations/${first.json().id}/end`,
          headers: authHeader(sim.serviceToken),
          payload: { tenantId, endReason: "caller_hangup" },
        });

        const admittedAfterRelease = await sim.inject({
          method: "POST",
          url: "/v1/conversations",
          headers: authHeader(sim.serviceToken),
          payload: startPayload({ tenantId, businessId }),
        });
        expect(admittedAfterRelease.statusCode).toBe(201);
      } finally {
        if (originalLimit === undefined) {
          delete process.env["MAX_TENANT_CONCURRENT_CALLS"];
        } else {
          process.env["MAX_TENANT_CONCURRENT_CALLS"] = originalLimit;
        }
      }
    });

    it("an emergency-priority call can be admitted into the headroom band even when normal-call capacity is exhausted", async () => {
      const originalLimit = process.env["MAX_TENANT_CONCURRENT_CALLS"];
      process.env["MAX_TENANT_CONCURRENT_CALLS"] = "10";
      try {
        const tenantId = randomUUID();
        const businessId = randomUUID();
        // Default emergencyHeadroomRatio (StaticCapacityConfigProvider) is
        // 0.2 -> normal ceiling = floor(10 * 0.8) = 8.
        const normalPayloads = Array.from({ length: 8 }, () =>
          startPayload({ tenantId, businessId }),
        );
        const normalResponses = await Promise.all(
          normalPayloads.map((payload) =>
            sim.inject({
              method: "POST",
              url: "/v1/conversations",
              headers: authHeader(sim.serviceToken),
              payload,
            }),
          ),
        );
        expect(normalResponses.every((r) => r.statusCode === 201)).toBe(true);

        const normalRejected = await sim.inject({
          method: "POST",
          url: "/v1/conversations",
          headers: authHeader(sim.serviceToken),
          payload: startPayload({ tenantId, businessId }),
        });
        expect(normalRejected.statusCode).toBe(429);

        const emergencyAdmitted = await sim.inject({
          method: "POST",
          url: "/v1/conversations",
          headers: authHeader(sim.serviceToken),
          payload: startPayload({ tenantId, businessId, isEmergencyPriority: true }),
        });
        expect(emergencyAdmitted.statusCode).toBe(201);
      } finally {
        if (originalLimit === undefined) {
          delete process.env["MAX_TENANT_CONCURRENT_CALLS"];
        } else {
          process.env["MAX_TENANT_CONCURRENT_CALLS"] = originalLimit;
        }
      }
    });

    it("global ceiling: enforces MAX_GLOBAL_CONCURRENT_CALLS across DIFFERENT tenants, even when each tenant is individually within its own limit", async () => {
      const originalGlobal = process.env["MAX_GLOBAL_CONCURRENT_CALLS"];
      process.env["MAX_GLOBAL_CONCURRENT_CALLS"] = "3";
      try {
        // 4 different tenants, one call each — well within any single
        // tenant's default ceiling, but over the global ceiling of 3.
        const payloads = Array.from({ length: 4 }, () => startPayload());
        const responses = await Promise.all(
          payloads.map((payload) =>
            sim.inject({
              method: "POST",
              url: "/v1/conversations",
              headers: authHeader(sim.serviceToken),
              payload,
            }),
          ),
        );
        const admitted = responses.filter((r) => r.statusCode === 201);
        const rejected = responses.filter((r) => r.statusCode === 429);
        expect(admitted).toHaveLength(3);
        expect(rejected).toHaveLength(1);
        expect(rejected[0]?.json().scope).toBe("global");
      } finally {
        if (originalGlobal === undefined) {
          delete process.env["MAX_GLOBAL_CONCURRENT_CALLS"];
        } else {
          process.env["MAX_GLOBAL_CONCURRENT_CALLS"] = originalGlobal;
        }
      }
    });
  });
});
