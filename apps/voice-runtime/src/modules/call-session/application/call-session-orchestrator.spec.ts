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
      // The most serious bug found this whole build, live: every real call
      // connected successfully and then NOTHING ever spoke, because
      // nothing anywhere produced an opening line — both sides waited in
      // silence for the other to speak first, forever. This asserts the
      // fix directly: the greeting from startConversation's response must
      // be spoken before the caller ever says anything.
      expect(tts.synthesizeCalls).toEqual(["Thanks for calling, how can I help?"]);

      const session = stt.sessions[0]!;
      session.emitFinalTranscript("my sink is leaking", 0.9);
      await flushMicrotasks();

      expect(orchestratorClient.turnCalls).toHaveLength(1);
      expect(orchestratorClient.turnCalls[0]?.req.transcript).toBe("my sink is leaking");
      expect(orchestratorClient.turnCalls[0]?.req.allowedTools).toEqual(
        expect.arrayContaining(["escalateEmergency", "createLead", "searchCustomer"]),
      );
      expect(tts.synthesizeCalls).toEqual([
        "Thanks for calling, how can I help?",
        "Got it, what's the issue?",
      ]);
      expect(sink.audioSent.length).toBeGreaterThan(0);
    });

    it("does not speak anything at call start, and logs a warning instead, when startConversation returns no greeting (defends against an older voice-orchestrator deployment)", async () => {
      const { orchestrator, orchestratorClient, tts } = buildOrchestratorUnderTest();
      const sink = new FakeMediaStreamSink();
      orchestratorClient.startResponses = [
        {
          id: "conv-1",
          tenantId: "tenant-1",
          businessId: "business-1",
          callId: "call-1",
          state: "greeting",
          llmModel: "gpt-4o",
          leadId: null,
          turnCount: 0,
          startedAt: new Date().toISOString(),
          endedAt: null,
          endReason: null,
          // greeting deliberately omitted
        },
      ];

      await orchestrator.onCallStart(baseParams(), sink);

      expect(tts.synthesizeCalls).toEqual([]);
    });
  });

  describe("interruption / barge-in", () => {
    it("aborts an in-flight turn directly when speech-started is CONFIRMED by real interim speech mid-turn (mechanism 1)", async () => {
      const { orchestrator, orchestratorClient, stt } = buildOrchestratorUnderTest();
      const sink = new FakeMediaStreamSink();
      orchestratorClient.hangTurnUntilAborted = true;

      await orchestrator.onCallStart(baseParams(), sink);
      const session = stt.sessions[0]!;
      session.emitFinalTranscript("hello", 0.9);
      await flushMicrotasks();
      const turnSignal = orchestratorClient.turnCalls[0]?.signal;
      expect(turnSignal?.aborted).toBe(false);

      // Turn call is in flight (hung) — a bare SpeechStarted alone must
      // NOT abort it (see the "does NOT treat a bare SpeechStarted"
      // test above); interim speech confirming it should.
      session.emitSpeechStarted();
      await flushMicrotasks();
      expect(turnSignal?.aborted).toBe(false);

      session.emitInterimSpeech();
      await flushMicrotasks();

      expect(turnSignal?.aborted).toBe(true);
      expect(orchestratorClient.interruptCalls).toHaveLength(0); // mechanism 1, not mechanism 2
    });

    it("calls the /interrupt endpoint and clears queued audio when speech-started fires (and is CONFIRMED by real interim speech) while TTS is playing between turns (mechanism 2)", async () => {
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

      // A bare SpeechStarted (the raw VAD signal) is deliberately NOT
      // enough on its own any more — see handleSpeechStarted's own
      // comment. Real interim speech confirms it.
      session.emitSpeechStarted();
      session.emitInterimSpeech();
      await flushMicrotasks();

      expect(sink.clearCount).toBeGreaterThanOrEqual(1);
      expect(orchestratorClient.interruptCalls).toHaveLength(1);
      expect(orchestratorClient.interruptCalls[0]?.req.tenantId).toBe("tenant-1");
    });

    it("does NOT treat a bare SpeechStarted (never confirmed by interim speech) as a barge-in — noise/breath/cough must not kill an in-flight response", async () => {
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
      await new Promise((r) => setTimeout(r, 5));

      session.emitSpeechStarted();
      // No emitInterimSpeech() — this is exactly a VAD blip with no real
      // speech behind it.
      await flushMicrotasks();

      expect(orchestratorClient.interruptCalls).toHaveLength(0);
      expect(sink.clearCount).toBe(0);
    });

    /**
     * The streaming redesign's own new safety mechanism, not covered by
     * either mechanism-1 or mechanism-2 test above: a turn's response
     * can now arrive as MULTIPLE chunks (one per LLM completion
     * iteration, docs/28 §C.3), spoken as they arrive rather than all
     * at once. A barge-in landing after chunk 1 has already started
     * playing but before chunk 2 has been spoken must cancel chunk 2
     * entirely — otherwise chunk 2 would start NEW audio playing after
     * the caller already interrupted, which is exactly the "AI talks
     * over the customer" failure mode this whole barge-in mechanism
     * exists to prevent. Chunk 1, already mid-flight when the barge-in
     * lands, is handled by the EXISTING ttsAbort/clearQueuedAudio path
     * (proven by the mechanism-2 test above) — this test's job is
     * specifically the QUEUED-but-not-yet-started second chunk.
     */
    it("cancels a NOT-YET-SPOKEN queued chunk when a barge-in lands between two streamed chunks of the same turn", async () => {
      const { orchestrator, orchestratorClient, stt, tts } = buildOrchestratorUnderTest();
      const sink = new FakeMediaStreamSink();
      tts.chunkDelayMs = 30;
      orchestratorClient.turnResponses = [
        {
          conversationId: "conv-1",
          responseText: "First chunk text. Second chunk text.",
          toolCallsExecuted: [],
          interrupted: false,
          state: "qualifying",
        },
      ];
      orchestratorClient.turnResponseChunks = [["First chunk text.", "Second chunk text."]];

      await orchestrator.onCallStart(baseParams(), sink);
      const session = stt.sessions[0]!;
      session.emitFinalTranscript("hello", 0.9);
      // Give chunk 1's speak() call time to actually start (and begin
      // its own chunkDelayMs-paced playback) but not to finish.
      await new Promise((r) => setTimeout(r, 10));

      session.emitSpeechStarted();
      session.emitInterimSpeech();
      await flushMicrotasks();
      // Let anything still in flight settle — long enough that a
      // wrongly-spoken second chunk would have had time to start.
      await new Promise((r) => setTimeout(r, 150));

      expect(tts.synthesizeCalls).toContain("First chunk text.");
      expect(tts.synthesizeCalls).not.toContain("Second chunk text.");
    });

    /**
     * Scenario G from the barge-in hardening pass: the caller doesn't
     * pause after interrupting — they keep talking immediately, so a
     * NEW finalized transcript can arrive right on the heels of the
     * barge-in, before anything from the old turn could meaningfully
     * "settle." This proves the new turn is processed on its own
     * merits (its own idempotencyKey, its own abortController, its own
     * speakQueue — see handleFinalTranscript's own comment on why none
     * of that state is shared across separate finalized-transcript
     * events) and that the aborted turn's response — which was never
     * produced, since it was hung/interrupted before the fake ever
     * resolved — never leaks through as stale or duplicate speech.
     */
    it("processes the caller's new speech correctly when it arrives immediately after a barge-in, with no stale or duplicate response", async () => {
      const { orchestrator, orchestratorClient, stt, tts } = buildOrchestratorUnderTest();
      const sink = new FakeMediaStreamSink();
      orchestratorClient.hangTurnUntilAborted = true;

      await orchestrator.onCallStart(baseParams(), sink);
      const session = stt.sessions[0]!;

      session.emitFinalTranscript("first thing customer said", 0.9);
      await flushMicrotasks();

      // Barge-in fires while turn 1 is still hung (mechanism 1) — abort it.
      session.emitSpeechStarted();
      await flushMicrotasks();

      // The caller keeps talking immediately — script the SECOND
      // attempt to actually resolve normally, the same as a real retry
      // of a genuinely different HTTP call would.
      orchestratorClient.hangTurnUntilAborted = false;
      orchestratorClient.turnResponses = [
        {
          conversationId: "conv-1",
          responseText: "Got it, tell me more about that.",
          toolCallsExecuted: [],
          interrupted: false,
          state: "qualifying",
        },
      ];
      session.emitFinalTranscript("second thing customer said, right after interrupting", 0.9);
      await flushMicrotasks();

      expect(orchestratorClient.turnCalls).toHaveLength(2);
      expect(orchestratorClient.turnCalls[1]?.req.transcript).toBe(
        "second thing customer said, right after interrupting",
      );
      // The old (aborted, hung) turn never produced a response to
      // speak — the new turn's response is the ONLY one spoken, proving
      // no stale/duplicate speech leaked through from the interrupted turn.
      expect(
        tts.synthesizeCalls.filter((call) => call === "Got it, tell me more about that."),
      ).toHaveLength(1);
    });

    /**
     * Defense-in-depth regression, found while auditing barge-in for a real
     * "not responding" call report: this codebase's ONLY protection against
     * two turns ever running concurrently was that Deepgram's SpeechStarted
     * (driving handleBargeIn) always fires before the speech_final event
     * for the SAME utterance — handleFinalTranscript itself never checked
     * or aborted a still-active previous turn before starting a new one.
     * That's a latent gap, not yet a proven live bug (this exact STT
     * ordering has held so far), but nothing enforced it — a future
     * change to the barge-in trigger, or an unexpected STT provider event
     * ordering, could let an old turn's response speak stale/contradictory
     * audio over a newer turn's, since `bargedInDuringCurrentTurn` (which
     * would otherwise silence it) gets reset to `false` by the NEW turn's
     * own handleFinalTranscript call before the OLD one ever settles.
     * Proves the fix directly: a second finalized transcript arrives with
     * NO emitSpeechStarted() in between, and the first turn's own
     * AbortSignal must still end up aborted.
     */
    it("aborts a still-active previous turn's AbortSignal when a new finalized transcript arrives, even with no intervening speech-started event", async () => {
      const { orchestrator, orchestratorClient, stt } = buildOrchestratorUnderTest();
      const sink = new FakeMediaStreamSink();
      orchestratorClient.hangTurnUntilAborted = true;

      await orchestrator.onCallStart(baseParams(), sink);
      const session = stt.sessions[0]!;

      session.emitFinalTranscript("first thing customer said", 0.9);
      await flushMicrotasks();
      const firstTurnSignal = orchestratorClient.turnCalls[0]?.signal;
      expect(firstTurnSignal?.aborted).toBe(false);

      // NO session.emitSpeechStarted() here — the ONLY thing that should
      // stop the first turn is handleFinalTranscript's own guard.
      session.emitFinalTranscript("second thing, no barge-in event ever fired", 0.9);
      await flushMicrotasks();

      expect(orchestratorClient.turnCalls).toHaveLength(2);
      expect(firstTurnSignal?.aborted).toBe(true);
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
      expect(tts.synthesizeCalls.at(-1)).toMatch(/trouble/i);
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
          escalation: { severity: "critical", action: "forward_call", transferDestination: null },
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

    /**
     * Regression coverage for a real gap found live while tracing the
     * complete emergency-escalation path: ResolveOnCallUseCase (core-api)
     * was fully built and tested but never actually wired into a live call
     * transfer — every emergency rang the SAME static number regardless of
     * who was actually on call. This proves the resolved destination now
     * takes priority over the static env-var chain when core-api supplies
     * one.
     */
    it("prefers the server-resolved on-call destination over the static EMERGENCY_TRANSFER_NUMBER when both are available", async () => {
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
          escalation: {
            severity: "critical",
            action: "forward_call",
            transferDestination: "+15551230000",
          },
        },
      ];

      await orchestrator.onCallStart(baseParams({ callSid: "CA-oncall" }), sink);
      const session = stt.sessions[0]!;
      session.emitFinalTranscript("burst pipe flooding my basement", 0.9);
      await flushMicrotasks();

      expect(callTransfer.transferCalls).toHaveLength(1);
      expect(callTransfer.transferCalls[0]).toEqual({
        callSid: "CA-oncall",
        destination: "+15551230000",
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
          escalation: { severity: "critical", action: "forward_call", transferDestination: null },
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
          escalation: { severity: "critical", action: "forward_call", transferDestination: null },
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
          escalation: { severity: "medium", action: "priority_notify", transferDestination: null },
        },
      ];

      await orchestrator.onCallStart(baseParams(), sink);
      const session = stt.sessions[0]!;
      session.emitFinalTranscript("my water heater is old", 0.9);
      await flushMicrotasks();

      expect(callTransfer.transferCalls).toHaveLength(0);
    });
  });

  describe("capacity rejection (429) at call start", () => {
    /**
     * Regression coverage for a real gap found live: docs/36 §3 admits
     * capacity at exactly this call (StartConversationUseCase's FIRST
     * gate), so this is the PRIMARY case docs/36 §4's "play the
     * waiting/brochure experience and retry" is describing — not the
     * mid-turn case, which already had this exact retry loop. Before this
     * fix, onCallStart's catch-all treated a capacity-429 the same as any
     * other start failure: immediate apology and hangup, never the
     * brochure/retry experience the 429 response body is specifically
     * shaped to support.
     */
    it("speaks the brochure segment and retries the call-start itself after retryAfterSeconds, then proceeds normally", async () => {
      jest.useFakeTimers();
      try {
        const { orchestrator, orchestratorClient, stt, tts } = buildOrchestratorUnderTest();
        const sink = new FakeMediaStreamSink();
        orchestratorClient.startResponses = [
          new OrchestratorCapacityExceededError(0, {
            brochureSegment: { id: "seg-1", text: "We're licensed and insured." },
            overflowNumber: null,
          }),
        ];

        const startPromise = orchestrator.onCallStart(baseParams(), sink);
        await jest.advanceTimersByTimeAsync(0);
        await startPromise;

        expect(tts.synthesizeCalls).toContain("We're licensed and insured.");
        expect(orchestratorClient.startCalls).toHaveLength(2);
        expect(stt.sessions).toHaveLength(1); // the STT session opens only after the retry succeeds
      } finally {
        jest.useRealTimers();
      }
    });

    it("gives up and apologizes once the call-start capacity retry budget is exhausted", async () => {
      jest.useFakeTimers();
      try {
        const { orchestrator, orchestratorClient, stt, tts } = buildOrchestratorUnderTest();
        const sink = new FakeMediaStreamSink();
        const capacityError = (): OrchestratorCapacityExceededError =>
          new OrchestratorCapacityExceededError(0, {
            brochureSegment: null,
            overflowNumber: null,
          });
        orchestratorClient.startResponses = [
          capacityError(),
          capacityError(),
          capacityError(),
          capacityError(),
        ];

        const startPromise = orchestrator.onCallStart(baseParams(), sink);
        await jest.runAllTimersAsync();
        await startPromise;

        expect(tts.synthesizeCalls.at(-1)).toMatch(/unable to take your call/i);
        expect(sink.closed).toBe(true);
        expect(stt.sessions).toHaveLength(0); // never got far enough to open STT
      } finally {
        jest.useRealTimers();
      }
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
