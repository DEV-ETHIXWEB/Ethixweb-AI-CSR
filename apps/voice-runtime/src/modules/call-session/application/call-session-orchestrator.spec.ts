import { FakeCallTransferProvider } from "../../telephony/infrastructure/__fakes__/fake-call-transfer.provider";
import {
  OrchestratorCapacityExceededError,
  OrchestratorHttpError,
} from "../../orchestrator-client/domain/orchestrator-client.port";
import { FakeOrchestratorClient } from "../../orchestrator-client/infrastructure/__fakes__/fake-orchestrator-client";
import { FakeSpeechToTextProvider } from "../../speech/infrastructure/__fakes__/fake-speech-to-text.provider";
import { FakeTextToSpeechProvider } from "../../speech/infrastructure/__fakes__/fake-text-to-speech.provider";
import type { CallSessionParams } from "../domain/call-session";
import { CallSessionOrchestrator } from "./call-session-orchestrator";
import { createNoopLogger } from "./__fakes__/fake-logger";
import { FakeMediaStreamSink } from "./__fakes__/fake-media-stream-sink";

function baseParams(overrides: Partial<CallSessionParams> = {}): CallSessionParams {
  return {
    callId: "call-1",
    tenantId: "tenant-1",
    businessId: "business-1",
    callerAni: "+15551234567",
    callSid: "CAxxxx",
    streamSid: "MZxxxx",
    ...overrides,
  };
}

function buildOrchestratorUnderTest() {
  const orchestratorClient = new FakeOrchestratorClient();
  const stt = new FakeSpeechToTextProvider();
  const tts = new FakeTextToSpeechProvider();
  const callTransfer = new FakeCallTransferProvider();
  const orchestrator = new CallSessionOrchestrator(
    orchestratorClient,
    stt,
    tts,
    callTransfer,
    createNoopLogger(),
  );
  return { orchestrator, orchestratorClient, stt, tts, callTransfer };
}

describe("CallSessionOrchestrator", () => {
  const originalEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("normal conversation", () => {
    it("starts a conversation, opens an STT session, and on a finalized transcript sends a turn and speaks the response", async () => {
      const { orchestrator, orchestratorClient, stt, tts } = buildOrchestratorUnderTest();
      const sink = new FakeMediaStreamSink();
      const params = baseParams();
      orchestratorClient.turnResponses = [
        {
          conversationId: "conv-1",
          responseText: "Got it, what's the issue?",
          toolCallsExecuted: [],
          interrupted: false,
          state: "qualifying",
        },
      ];

      await orchestrator.onCallStart(params, sink);
      expect(orchestratorClient.startCalls).toHaveLength(1);
      expect(orchestratorClient.startCalls[0]).toMatchObject({
        tenantId: "tenant-1",
        businessId: "business-1",
        callId: "call-1",
        callerAni: "+15551234567",
      });

      const session = stt.sessions[0]!;
      session.emitFinalTranscript("my sink is leaking", 0.9);
      await flushMicrotasks();

      expect(orchestratorClient.turnCalls).toHaveLength(1);
      expect(orchestratorClient.turnCalls[0]?.req.transcript).toBe("my sink is leaking");
      expect(orchestratorClient.turnCalls[0]?.req.allowedTools).toEqual(
        expect.arrayContaining(["escalateEmergency", "createLead", "searchCustomer"]),
      );
      expect(tts.synthesizeCalls).toEqual(["Got it, what's the issue?"]);
      expect(sink.audioSent.length).toBeGreaterThan(0);
    });
  });

  describe("interruption / barge-in", () => {
    it("aborts an in-flight turn directly when speech-started fires mid-turn (mechanism 1)", async () => {
      const { orchestrator, orchestratorClient, stt } = buildOrchestratorUnderTest();
      const sink = new FakeMediaStreamSink();
      orchestratorClient.hangTurnUntilAborted = true;

      await orchestrator.onCallStart(baseParams(), sink);
      const session = stt.sessions[0]!;
      session.emitFinalTranscript("hello", 0.9);
      await flushMicrotasks();

      // Turn call is in flight (hung) — speech-started now should abort it directly.
      session.emitSpeechStarted();
      await flushMicrotasks();

      expect(orchestratorClient.interruptCalls).toHaveLength(0); // mechanism 1, not mechanism 2
    });

    it("calls the /interrupt endpoint and clears queued audio when speech-started fires while TTS is playing between turns (mechanism 2)", async () => {
      const { orchestrator, orchestratorClient, stt, tts } = buildOrchestratorUnderTest();
      const sink = new FakeMediaStreamSink();
      tts.chunkDelayMs = 20;
      orchestratorClient.turnResponses = [
        {
          conversationId: "conv-1",
          responseText: "Let me look that up for you, one moment please.",
          toolCallsExecuted: [],
          interrupted: false,
          state: "qualifying",
        },
      ];

      await orchestrator.onCallStart(baseParams(), sink);
      const session = stt.sessions[0]!;
      session.emitFinalTranscript("hello", 0.9);
      // Don't await — TTS is now mid-stream (chunkDelayMs keeps it "playing").
      await new Promise((r) => setTimeout(r, 5));

      session.emitSpeechStarted();
      await flushMicrotasks();

      expect(sink.clearCount).toBeGreaterThanOrEqual(1);
      expect(orchestratorClient.interruptCalls).toHaveLength(1);
      expect(orchestratorClient.interruptCalls[0]?.req.tenantId).toBe("tenant-1");
    });
  });

  describe("duplicate turn (idempotency)", () => {
    it("generates a fresh idempotencyKey per distinct finalized transcript, not reused across separate turns", async () => {
      const { orchestrator, orchestratorClient, stt } = buildOrchestratorUnderTest();
      const sink = new FakeMediaStreamSink();
      orchestratorClient.turnResponses = [
        {
          conversationId: "conv-1",
          responseText: "ok",
          toolCallsExecuted: [],
          interrupted: false,
          state: "qualifying",
        },
        {
          conversationId: "conv-1",
          responseText: "ok again",
          toolCallsExecuted: [],
          interrupted: false,
          state: "qualifying",
        },
      ];

      await orchestrator.onCallStart(baseParams(), sink);
      const session = stt.sessions[0]!;
      session.emitFinalTranscript("first thing", 0.9);
      await flushMicrotasks();
      session.emitFinalTranscript("second thing", 0.9);
      await flushMicrotasks();

      const keys = orchestratorClient.turnCalls.map((c) => c.req.idempotencyKey);
      expect(new Set(keys).size).toBe(2);
    });
  });

  describe("provider timeout / failure", () => {
    it("retries a 5xx turn failure with the SAME idempotencyKey and eventually succeeds", async () => {
      const { orchestrator, orchestratorClient, stt, tts } = buildOrchestratorUnderTest();
      const sink = new FakeMediaStreamSink();
      orchestratorClient.turnResponses = [
        new OrchestratorHttpError("boom", 503, true),
        {
          conversationId: "conv-1",
          responseText: "sorted now",
          toolCallsExecuted: [],
          interrupted: false,
          state: "qualifying",
        },
      ];

      await orchestrator.onCallStart(baseParams(), sink);
      const session = stt.sessions[0]!;
      session.emitFinalTranscript("hi", 0.9);
      await flushMicrotasks();
      await new Promise((r) => setTimeout(r, 600));

      expect(orchestratorClient.turnCalls).toHaveLength(2);
      const [first, second] = orchestratorClient.turnCalls;
      expect(first?.req.idempotencyKey).toBe(second?.req.idempotencyKey);
      expect(tts.synthesizeCalls).toContain("sorted now");
    });

    it("speaks a degraded apology and stops retrying once the non-retryable/exhausted turn failure budget is hit", async () => {
      const { orchestrator, orchestratorClient, stt, tts } = buildOrchestratorUnderTest();
      const sink = new FakeMediaStreamSink();
      orchestratorClient.turnResponses = [new OrchestratorHttpError("bad request", 400, false)];

      await orchestrator.onCallStart(baseParams(), sink);
      const session = stt.sessions[0]!;
      session.emitFinalTranscript("hi", 0.9);
      await flushMicrotasks();

      expect(orchestratorClient.turnCalls).toHaveLength(1); // non-retryable — no retry attempted
      expect(tts.synthesizeCalls[0]).toMatch(/trouble/i);
    });

    it("degrades gracefully (apology + close) when the STT provider fails to open a session", async () => {
      const { orchestrator, stt, tts } = buildOrchestratorUnderTest();
      const sink = new FakeMediaStreamSink();
      stt.failNextOpenWith = new Error("Deepgram unreachable");

      await orchestrator.onCallStart(baseParams(), sink);

      expect(tts.synthesizeCalls[0]).toMatch(/unable to take your call/i);
      expect(sink.closed).toBe(true);
    });

    /**
     * Regression coverage for a real bug found live: previously, an STT
     * session error AFTER a successful open only logged a warning, no
     * recovery action. `ws`'s WebSocket never reconnects on its own and
     * DeepgramSttSession has no reconnect logic either, so once this
     * fires, STT is permanently dead for the rest of the call, the caller
     * could talk for the remainder of the call and never be transcribed,
     * with nothing ever telling them or ending the call. This should
     * degrade exactly the same way openSession() itself failing already
     * does.
     */
    it("degrades gracefully (apology + close) when the STT session errors AFTER opening successfully, not just on open failure", async () => {
      const { orchestrator, stt, tts } = buildOrchestratorUnderTest();
      const sink = new FakeMediaStreamSink();

      await orchestrator.onCallStart(baseParams(), sink);
      const session = stt.sessions[0]!;
      session.emitError(new Error("connection reset"));
      await flushMicrotasks();

      expect(tts.synthesizeCalls.at(-1)).toMatch(/unable to take your call/i);
      expect(sink.closed).toBe(true);
    });

    it("does not attempt a second apology when the STT session errors after the call has already ended", async () => {
      const { orchestrator, stt, tts, orchestratorClient } = buildOrchestratorUnderTest();
      const sink = new FakeMediaStreamSink();

      await orchestrator.onCallStart(baseParams(), sink);
      const session = stt.sessions[0]!;
      await orchestrator.onCallEnd(baseParams(), "caller_hangup");
      const synthesizeCallsBeforeError = tts.synthesizeCalls.length;

      session.emitError(new Error("connection reset after hangup"));
      await flushMicrotasks();

      expect(tts.synthesizeCalls).toHaveLength(synthesizeCallsBeforeError);
      expect(orchestratorClient.endCalls).toHaveLength(1);
    });
  });

  describe("orchestrator failure at call start", () => {
    it("speaks an apology and closes the stream when POST /conversations fails outright (docs/28 §J step 2)", async () => {
      const { orchestrator, orchestratorClient, tts } = buildOrchestratorUnderTest();
      const sink = new FakeMediaStreamSink();
      orchestratorClient.startResponses = [new OrchestratorHttpError("core-api down", 503, true)];

      await orchestrator.onCallStart(baseParams(), sink);

      expect(tts.synthesizeCalls[0]).toMatch(/unable to take your call/i);
      expect(sink.closed).toBe(true);
    });
  });

  describe("caller disconnect", () => {
    it("calls end-conversation with the given endReason and closes the STT session", async () => {
      const { orchestrator, orchestratorClient, stt } = buildOrchestratorUnderTest();
      const sink = new FakeMediaStreamSink();

      await orchestrator.onCallStart(baseParams(), sink);
      const session = stt.sessions[0]!;
      await orchestrator.onCallEnd(baseParams(), "caller_hangup");

      expect(orchestratorClient.endCalls).toHaveLength(1);
      expect(orchestratorClient.endCalls[0]?.req.endReason).toBe("caller_hangup");
      expect(session.closed).toBe(true);
    });

    it("is best-effort: a failing end-conversation call does not throw", async () => {
      const { orchestrator, orchestratorClient } = buildOrchestratorUnderTest();
      const sink = new FakeMediaStreamSink();
      await orchestrator.onCallStart(baseParams(), sink);
      orchestratorClient.endResponses = [new OrchestratorHttpError("down", 503, true)];

      await expect(orchestrator.onCallEnd(baseParams(), "caller_hangup")).resolves.toBeUndefined();
    });

    it("is idempotent: MediaStreamGateway calling onCallEnd twice for the same call (Twilio's stop event AND the socket's close event, exactly as it documents) sends only ONE end-conversation call", async () => {
      // Regression test for a real, previously-shipped bug: onCallEnd had
      // no guard at all against being invoked twice — only the turn-handling
      // path checked `this.ended`. MediaStreamGateway's own comment claims
      // this method's own `ended` guard makes a double call (stop + close,
      // or a network drop firing close without stop) safe; before the fix,
      // that claim was false, and this would have sent TWO real
      // end-conversation HTTP calls for the same conversation.
      const { orchestrator, orchestratorClient, stt } = buildOrchestratorUnderTest();
      const sink = new FakeMediaStreamSink();

      await orchestrator.onCallStart(baseParams(), sink);
      const session = stt.sessions[0]!;

      await orchestrator.onCallEnd(baseParams(), "caller_hangup");
      await orchestrator.onCallEnd(baseParams(), "runtime_disconnected");

      expect(orchestratorClient.endCalls).toHaveLength(1);
      expect(orchestratorClient.endCalls[0]?.req.endReason).toBe("caller_hangup");
      expect(session.closed).toBe(true);
    });
  });

  describe("emergency escalation", () => {
    it("executes a call transfer when a turn result signals escalation.action === forward_call", async () => {
      process.env["EMERGENCY_TRANSFER_NUMBER"] = "+15559990000";
      const { orchestrator, orchestratorClient, stt, callTransfer } = buildOrchestratorUnderTest();
      const sink = new FakeMediaStreamSink();
      orchestratorClient.turnResponses = [
        {
          conversationId: "conv-1",
          responseText: "Connecting you now, please stay on the line.",
          toolCallsExecuted: ["escalateEmergency"],
          interrupted: false,
          state: "emergency_transfer",
          escalation: { severity: "critical", action: "forward_call" },
        },
      ];

      await orchestrator.onCallStart(baseParams({ callSid: "CA-emergency" }), sink);
      const session = stt.sessions[0]!;
      session.emitFinalTranscript("burst pipe flooding my basement", 0.9);
      await flushMicrotasks();

      expect(callTransfer.transferCalls).toHaveLength(1);
      expect(callTransfer.transferCalls[0]).toEqual({
        callSid: "CA-emergency",
        destination: "+15559990000",
      });
    });

    it("does not attempt a transfer, and logs rather than crashes, when EMERGENCY_TRANSFER_NUMBER is not configured", async () => {
      delete process.env["EMERGENCY_TRANSFER_NUMBER"];
      const { orchestrator, orchestratorClient, stt, callTransfer } = buildOrchestratorUnderTest();
      const sink = new FakeMediaStreamSink();
      orchestratorClient.turnResponses = [
        {
          conversationId: "conv-1",
          responseText: "Connecting you now.",
          toolCallsExecuted: ["escalateEmergency"],
          interrupted: false,
          state: "emergency_transfer",
          escalation: { severity: "critical", action: "forward_call" },
        },
      ];

      await orchestrator.onCallStart(baseParams(), sink);
      const session = stt.sessions[0]!;
      session.emitFinalTranscript("burst pipe", 0.9);
      await flushMicrotasks();

      expect(callTransfer.transferCalls).toHaveLength(0);
    });

    it("falls back to HUMAN_FALLBACK_NUMBER when EMERGENCY_TRANSFER_NUMBER specifically is not configured — some real human destination beats silently continuing the AI conversation", async () => {
      delete process.env["EMERGENCY_TRANSFER_NUMBER"];
      process.env["HUMAN_FALLBACK_NUMBER"] = "+15550001111";
      const { orchestrator, orchestratorClient, stt, callTransfer } = buildOrchestratorUnderTest();
      const sink = new FakeMediaStreamSink();
      orchestratorClient.turnResponses = [
        {
          conversationId: "conv-1",
          responseText: "Connecting you now.",
          toolCallsExecuted: ["escalateEmergency"],
          interrupted: false,
          state: "emergency_transfer",
          escalation: { severity: "critical", action: "forward_call" },
        },
      ];

      await orchestrator.onCallStart(baseParams({ callSid: "CA-emergency-fallback" }), sink);
      const session = stt.sessions[0]!;
      session.emitFinalTranscript("burst pipe flooding my basement", 0.9);
      await flushMicrotasks();

      expect(callTransfer.transferCalls).toHaveLength(1);
      expect(callTransfer.transferCalls[0]).toEqual({
        callSid: "CA-emergency-fallback",
        destination: "+15550001111",
      });
    });

    it("does not attempt a transfer for a non-forward_call escalation action (e.g. priority_notify)", async () => {
      const { orchestrator, orchestratorClient, stt, callTransfer } = buildOrchestratorUnderTest();
      const sink = new FakeMediaStreamSink();
      orchestratorClient.turnResponses = [
        {
          conversationId: "conv-1",
          responseText: "Noted, someone will call you back shortly.",
          toolCallsExecuted: ["escalateEmergency"],
          interrupted: false,
          state: "qualifying",
          escalation: { severity: "medium", action: "priority_notify" },
        },
      ];

      await orchestrator.onCallStart(baseParams(), sink);
      const session = stt.sessions[0]!;
      session.emitFinalTranscript("my water heater is old", 0.9);
      await flushMicrotasks();

      expect(callTransfer.transferCalls).toHaveLength(0);
    });
  });

  describe("capacity rejection (429)", () => {
    it("speaks the brochure segment and retries after retryAfterSeconds, then succeeds", async () => {
      jest.useFakeTimers();
      try {
        const { orchestrator, orchestratorClient, stt, tts } = buildOrchestratorUnderTest();
        const sink = new FakeMediaStreamSink();
        orchestratorClient.turnResponses = [
          new OrchestratorCapacityExceededError(0, {
            brochureSegment: { id: "seg-1", text: "We're licensed and insured." },
            overflowNumber: null,
          }),
          {
            conversationId: "conv-1",
            responseText: "Thanks for waiting, go ahead.",
            toolCallsExecuted: [],
            interrupted: false,
            state: "qualifying",
          },
        ];

        await orchestrator.onCallStart(baseParams(), sink);
        const session = stt.sessions[0]!;
        session.emitFinalTranscript("hi", 0.9);

        await jest.advanceTimersByTimeAsync(0);
        await jest.advanceTimersByTimeAsync(0);

        expect(tts.synthesizeCalls).toContain("We're licensed and insured.");
        expect(orchestratorClient.turnCalls).toHaveLength(2);
        expect(tts.synthesizeCalls).toContain("Thanks for waiting, go ahead.");
      } finally {
        jest.useRealTimers();
      }
    });
  });
});

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
