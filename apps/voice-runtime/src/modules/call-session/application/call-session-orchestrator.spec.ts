import { FakeCallTransferProvider } from "../../telephony/infrastructure/__fakes__/fake-call-transfer.provider";
import {
  OrchestratorCapacityExceededError,
  OrchestratorHttpError,
} from "../../orchestrator-client/domain/orchestrator-client.port";
import { FakeOrchestratorClient } from "../../orchestrator-client/infrastructure/__fakes__/fake-orchestrator-client";
import { FakeSpeechToTextProvider } from "../../speech/infrastructure/__fakes__/fake-speech-to-text.provider";
import { FakeTextToSpeechProvider } from "../../speech/infrastructure/__fakes__/fake-text-to-speech.provider";
import { DEFAULT_VOICE_DELIVERY_SETTINGS } from "../../speech/domain/text-to-speech.port";
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

/** Same as `buildOrchestratorUnderTest`, plus its own fresh `FakeMediaStreamSink` — a convenience for tests (emotional-delivery's [pause] silence-buffer assertions) that need to inspect the RAW audio the sink received, not just which text was synthesized. */
function buildOrchestratorWithSink() {
  return { ...buildOrchestratorUnderTest(), sink: new FakeMediaStreamSink() };
}

describe("CallSessionOrchestrator", () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    // Tiny by default for every test in this file — most of them go
    // through onCallStart (which now arms a real silence-check-in timer
    // after the greeting) without ever calling onCallEnd, since they're
    // testing something else entirely. Left at the real 10s default,
    // that dangling timer kept the whole process alive for the full 10s
    // after each test run finished (found running this exact suite).
    // The "silence check-in" describe block below overrides this to a
    // real, meaningful value for the tests that actually exercise it.
    process.env["SILENCE_CHECK_IN_TIMEOUT_MS"] = "5";
    // Same rationale, same fix, for the barge-in confirmation window —
    // widened to a real 2000ms in production (see
    // DEFAULT_BARGE_IN_CONFIRMATION_TIMEOUT_MS's own comment for why),
    // which left a real, dangling setTimeout in every test that goes
    // through handleSpeechStarted without fake timers or an explicit
    // onCallEnd. Any test that specifically exercises this window's own
    // timing overrides it back to a real, meaningful value.
    process.env["BARGE_IN_CONFIRMATION_TIMEOUT_MS"] = "5";
    // Same rationale again for the post-goodbye pause before the line is
    // actually dropped (2s in production). The farewell describe block
    // below sets its own values where the timing is the point.
    process.env["FAREWELL_HANGUP_GRACE_MS"] = "5";
  });
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

    it("REAL-CALL REGRESSION 9ecc6846: stops Grace when the caller talks while her reply is still PLAYING, even though it finished SENDING instantly", async () => {
      const { orchestrator, orchestratorClient, stt, tts } = buildOrchestratorUnderTest();
      const sink = new FakeMediaStreamSink();
      // Exactly the live shape: cached / Flash audio handed over at once, no
      // per-chunk delay, but 3 x 2s = 6 seconds of real speech queued at Twilio.
      tts.chunkBytes = 16_000;
      tts.chunkDelayMs = 0;
      orchestratorClient.turnResponses = [
        {
          conversationId: "conv-1",
          responseText: "Got it, a leaking water heater. Is it dripping or pouring out?",
          toolCallsExecuted: [],
          interrupted: false,
          state: "qualifying",
        },
      ];

      await orchestrator.onCallStart(baseParams(), sink);
      const session = stt.sessions[0]!;
      session.emitFinalTranscript("my water heater is leaking", 0.95);
      await flushMicrotasks();
      await new Promise((r) => setTimeout(r, 30));
      const clearsBeforeBargeIn = sink.clearCount;
      const interruptsBeforeBargeIn = orchestratorClient.interruptCalls.length;

      // Sending is long over; six seconds of her voice is still playing.
      session.emitSpeechStarted();
      session.emitInterimSpeech();
      await flushMicrotasks();

      expect(sink.clearCount).toBeGreaterThan(clearsBeforeBargeIn);
      expect(orchestratorClient.interruptCalls.length).toBe(interruptsBeforeBargeIn + 1);
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

    /**
     * REAL-CALL REGRESSION: root-caused from a real ~4m44s call's own
     * structured logs, where the caller repeatedly complained mid-call —
     * "why you are not giving time to speak," "i'm speaking and you are
     * like interrupting me so much," "keep quiet." Deepgram's first
     * interim result with real recognized content arrived 821ms after
     * its own SpeechStarted event — comfortably past the OLD 500ms
     * confirmation window, which had already expired and nulled
     * `pendingBargeInTimer` by the time that content arrived, so
     * `handleInterimSpeech`'s own guard silently discarded it (and every
     * later interim event in the same episode) until the NEXT raw
     * SpeechStarted fired — which Deepgram does not emit again
     * mid-utterance. Grace's stale TTS kept playing, unaborted, for
     * roughly 3.8 more seconds while the caller was audibly already
     * speaking. Runs against the REAL production default (no test
     * override), with a real delay standing in for that exact
     * real-world latency, to prove the widened window actually closes
     * the gap rather than just moving a number around.
     */
    it("REAL-CALL REGRESSION: still confirms barge-in when real interim speech arrives ~900ms after SpeechStarted, using the real production default window", async () => {
      const originalBargeInTimeout = process.env["BARGE_IN_CONFIRMATION_TIMEOUT_MS"];
      delete process.env["BARGE_IN_CONFIRMATION_TIMEOUT_MS"]; // use the real DEFAULT_BARGE_IN_CONFIRMATION_TIMEOUT_MS (2000ms), not this file's own tiny test override
      try {
        const { orchestrator, orchestratorClient, stt } = buildOrchestratorUnderTest();
        const sink = new FakeMediaStreamSink();
        orchestratorClient.hangTurnUntilAborted = true;

        await orchestrator.onCallStart(baseParams(), sink);
        const session = stt.sessions[0]!;
        session.emitFinalTranscript("hello", 0.9);
        await flushMicrotasks();
        const turnSignal = orchestratorClient.turnCalls[0]?.signal;

        session.emitSpeechStarted();
        await new Promise((r) => setTimeout(r, 900)); // mirrors the real call's own 821ms gap — the OLD 500ms window would already have expired by now
        session.emitInterimSpeech("i'm speaking and you are interrupting me so much");
        await flushMicrotasks();

        expect(turnSignal?.aborted).toBe(true);
      } finally {
        if (originalBargeInTimeout === undefined) {
          delete process.env["BARGE_IN_CONFIRMATION_TIMEOUT_MS"];
        } else {
          process.env["BARGE_IN_CONFIRMATION_TIMEOUT_MS"] = originalBargeInTimeout;
        }
      }
    }, 10000);

    /**
     * REAL-CALL REGRESSION, the second half of the same finding: even
     * with the confirmation window fixed, a genuine interruption could
     * still slip through if interim confirmation is delayed past
     * whatever window is configured. `handleFinalTranscript`'s own
     * defensive guard used to only ever abort `activeTurnAbort` (an
     * in-flight HTTP call) — by the time TTS is actually PLAYING, that
     * call has usually already completed, so the guard did nothing.
     * This proves the fix: a brand new FINALIZED transcript — the one
     * signal that's ALWAYS 100% certain proof the caller spoke,
     * regardless of how the interim path performed — now stops stale
     * TTS unconditionally, with no prior confirmed interim barge-in
     * required at all.
     */
    it("REAL-CALL REGRESSION: a new finalized transcript stops stale TTS still playing between turns, even with no confirmed interim-speech barge-in first", async () => {
      const { orchestrator, orchestratorClient, stt, tts } = buildOrchestratorUnderTest();
      const sink = new FakeMediaStreamSink();
      tts.chunkDelayMs = 20;
      orchestratorClient.turnResponses = [
        {
          conversationId: "conv-1",
          responseText: "You're right, I'm sorry. Go ahead — what's going on with the kitchen?",
          toolCallsExecuted: [],
          interrupted: false,
          state: "qualifying",
        },
      ];

      await orchestrator.onCallStart(baseParams(), sink);
      const session = stt.sessions[0]!;
      session.emitFinalTranscript("why you are not giving time to speak", 0.98);
      // Let the turn complete and TTS start playing (chunkDelayMs keeps
      // it "playing" for a bit) — mirrors the existing mechanism-2 test's
      // own timing.
      await new Promise((r) => setTimeout(r, 5));

      // Deliberately NO emitSpeechStarted()/emitInterimSpeech() at all —
      // this models the exact real-call gap where the interim-confirmation
      // path never (yet) fires, but a FINALIZED transcript arrives anyway.
      orchestratorClient.turnResponses = [
        {
          conversationId: "conv-1",
          responseText: "You're absolutely right — I'll let you finish. Tell me what's happening.",
          toolCallsExecuted: [],
          interrupted: false,
          state: "qualifying",
        },
      ];
      session.emitFinalTranscript("i'm speaking and you are like interrupting me so much", 0.99);
      await flushMicrotasks();

      expect(sink.clearCount).toBeGreaterThanOrEqual(1);
      expect(orchestratorClient.interruptCalls).toHaveLength(1);
    });

    it("a pure noise blip (SpeechStarted with nothing ever recognized) still eventually gives up once the FULL confirmation window elapses — widening it doesn't reintroduce the original over-triggering bug", async () => {
      const originalBargeInTimeout = process.env["BARGE_IN_CONFIRMATION_TIMEOUT_MS"];
      process.env["BARGE_IN_CONFIRMATION_TIMEOUT_MS"] = "50";
      try {
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
        await new Promise((r) => setTimeout(r, 80)); // past the 50ms window, nothing ever confirmed
        // A LATE interim event arriving after the window already gave up
        // must not retroactively fire a barge-in — deliberately NOT a
        // backchannel phrase, so this proves the timer-expiry gate itself
        // (not the separate isPureBackchannel gate) is what's blocking it.
        session.emitInterimSpeech("something completely different happened just now");
        await flushMicrotasks();

        expect(orchestratorClient.interruptCalls).toHaveLength(0);
        expect(sink.clearCount).toBe(0);
      } finally {
        if (originalBargeInTimeout === undefined) {
          delete process.env["BARGE_IN_CONFIRMATION_TIMEOUT_MS"];
        } else {
          process.env["BARGE_IN_CONFIRMATION_TIMEOUT_MS"] = originalBargeInTimeout;
        }
      }
    });
  });

  describe("backchannel filtering (mission: backchannels must not trigger barge-in)", () => {
    it("MISSION EXAMPLE: a pure backchannel ('uh huh') while a turn is in flight (mechanism 1) does NOT abort it", async () => {
      const { orchestrator, orchestratorClient, stt } = buildOrchestratorUnderTest();
      const sink = new FakeMediaStreamSink();
      orchestratorClient.hangTurnUntilAborted = true;

      await orchestrator.onCallStart(baseParams(), sink);
      const session = stt.sessions[0]!;
      session.emitFinalTranscript("hello", 0.9);
      await flushMicrotasks();
      const turnSignal = orchestratorClient.turnCalls[0]?.signal;

      session.emitSpeechStarted();
      session.emitInterimSpeech("uh huh");
      await flushMicrotasks();

      expect(turnSignal?.aborted).toBe(false);
    });

    it("MISSION EXAMPLE: a pure backchannel ('okay') while TTS is playing (mechanism 2) does NOT clear audio or call /interrupt", async () => {
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
      session.emitInterimSpeech("okay");
      await flushMicrotasks();

      expect(orchestratorClient.interruptCalls).toHaveLength(0);
      expect(sink.clearCount).toBe(0);
    });

    it("MISSION EXAMPLE: 'Yes, but...' — real speech that merely STARTS with an ack word — interrupts immediately, same as any other real speech", async () => {
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
      session.emitInterimSpeech("Yes, but that's not what I meant");
      await flushMicrotasks();

      expect(orchestratorClient.interruptCalls).toHaveLength(1);
      expect(sink.clearCount).toBeGreaterThanOrEqual(1);
    });

    it("a backchannel followed by real speech WITHIN the same confirmation window still interrupts, on the later (non-backchannel) interim update", async () => {
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
      session.emitInterimSpeech("okay"); // suppressed — pure backchannel
      await flushMicrotasks();
      expect(orchestratorClient.interruptCalls).toHaveLength(0);

      // Same utterance keeps growing, still within the 500ms confirmation
      // window (BARGE_IN_CONFIRMATION_TIMEOUT_MS) — Deepgram delivers a
      // fuller interim result for the SAME speech activity, no new
      // SpeechStarted needed.
      session.emitInterimSpeech("okay wait actually hold on");
      await flushMicrotasks();

      expect(orchestratorClient.interruptCalls).toHaveLength(1);
    });

    it("a backchannel while Grace ISN'T speaking and no turn is in flight behaves exactly as before — no special-casing when there's nothing to protect", async () => {
      const { orchestrator, stt, tts } = buildOrchestratorUnderTest();
      const sink = new FakeMediaStreamSink();

      await orchestrator.onCallStart(baseParams(), sink);
      const session = stt.sessions[0]!;
      // Greeting has already fully finished — nothing is playing, no turn
      // is in flight.
      await flushMicrotasks();

      session.emitSpeechStarted();
      session.emitInterimSpeech("okay");
      await flushMicrotasks();

      // Harmless no-op either way (handleBargeIn has nothing to act on) —
      // this just proves the backchannel gate didn't change that.
      expect(tts.synthesizeCalls).toEqual(["Thanks for calling, how can I help?"]);
    });
  });

  describe("emotional delivery (speak() strips [bracket] cues and resolves ElevenLabs voice_settings)", () => {
    it("MISSION EXAMPLE: a turn response with a leading emotional cue is spoken WITHOUT the bracket text, using a non-default voice profile", async () => {
      const { orchestrator, orchestratorClient, stt, tts } = buildOrchestratorUnderTest();
      const sink = new FakeMediaStreamSink();
      orchestratorClient.turnResponses = [
        {
          conversationId: "conv-1",
          responseText: "[sincere, warm] I'm sorry you're dealing with that.",
          toolCallsExecuted: [],
          interrupted: false,
          state: "qualifying",
        },
      ];
      await orchestrator.onCallStart(baseParams(), sink);
      stt.sessions[0]!.emitFinalTranscript("my sink is leaking everywhere", 0.9);
      await flushMicrotasks();

      expect(tts.synthesizeCalls).toContain("I'm sorry you're dealing with that.");
      expect(tts.synthesizeCalls.join(" ")).not.toMatch(/[[\]]/);
      const deliveredSettings =
        tts.voiceSettingsCalls[tts.synthesizeCalls.indexOf("I'm sorry you're dealing with that.")]!;
      expect(deliveredSettings.stability).toBeLessThan(0.5);
    });

    it("MISSION EXAMPLE: [pause] splits a response into two spoken segments with an explicit silence gap injected between them", async () => {
      const { orchestrator, orchestratorClient, stt, tts, sink } = buildOrchestratorWithSink();
      orchestratorClient.turnResponses = [
        {
          conversationId: "conv-1",
          responseText: "Okay, so what we can do is,[pause]let's figure it out.",
          toolCallsExecuted: [],
          interrupted: false,
          state: "qualifying",
        },
      ];
      await orchestrator.onCallStart(baseParams(), sink);
      stt.sessions[0]!.emitFinalTranscript("what can you do about it", 0.9);
      await flushMicrotasks();

      expect(tts.synthesizeCalls).toContain("Okay, so what we can do is,");
      expect(tts.synthesizeCalls).toContain("let's figure it out.");
      // A silence buffer (mu-law 0xFF bytes) was sent to the sink between
      // the two synthesize() calls — deterministic, not left to the TTS
      // vendor to interpret the pause on its own.
      const silenceFrame = sink.audioSent.find(
        (buf) => buf.length > 0 && buf.every((byte) => byte === 0xff),
      );
      expect(silenceFrame).toBeDefined();
    });

    it("an unsupported/malformed tag the model might emit despite the prompt is stripped and never reaches TTS as literal text", async () => {
      const { orchestrator, orchestratorClient, stt, tts, sink } = buildOrchestratorWithSink();
      orchestratorClient.turnResponses = [
        {
          conversationId: "conv-1",
          responseText: "[excitedly] Great news [unclosed we found your account.",
          toolCallsExecuted: [],
          interrupted: false,
          state: "qualifying",
        },
      ];
      await orchestrator.onCallStart(baseParams(), sink);
      stt.sessions[0]!.emitFinalTranscript("did you find my account", 0.9);
      await flushMicrotasks();

      for (const spoken of tts.synthesizeCalls) {
        expect(spoken).not.toMatch(/[[\]]/);
      }
    });

    it("plain text with no cues at all is spoken with the exact default voice settings — no behavior change for the common, untagged case", async () => {
      const { orchestrator, orchestratorClient, stt, tts, sink } = buildOrchestratorWithSink();
      orchestratorClient.turnResponses = [
        {
          conversationId: "conv-1",
          responseText: "Got it, what's the issue?",
          toolCallsExecuted: [],
          interrupted: false,
          state: "qualifying",
        },
      ];
      await orchestrator.onCallStart(baseParams(), sink);
      stt.sessions[0]!.emitFinalTranscript("hi", 0.9);
      await flushMicrotasks();

      const index = tts.synthesizeCalls.indexOf("Got it, what's the issue?");
      expect(index).toBeGreaterThanOrEqual(0);
      expect(tts.voiceSettingsCalls[index]).toEqual(DEFAULT_VOICE_DELIVERY_SETTINGS);
    });

    it("a barge-in landing DURING an injected [pause] silence gap still stops Grace immediately — ttsPlaying stays true across the gap", async () => {
      const { orchestrator, orchestratorClient, stt, tts, sink } = buildOrchestratorWithSink();
      tts.chunkDelayMs = 30;
      orchestratorClient.turnResponses = [
        {
          conversationId: "conv-1",
          responseText: "First part.[pause]Second part that should never be heard.",
          toolCallsExecuted: [],
          interrupted: false,
          state: "qualifying",
        },
      ];
      await orchestrator.onCallStart(baseParams(), sink);
      stt.sessions[0]!.emitFinalTranscript("hello", 0.9);
      // Let the first segment finish and the pause gap begin, but not
      // long enough for the second segment's synthesize() call to start.
      await new Promise((r) => setTimeout(r, 20));

      stt.sessions[0]!.emitSpeechStarted();
      stt.sessions[0]!.emitInterimSpeech("wait, hold on");
      await flushMicrotasks();
      await new Promise((r) => setTimeout(r, 100));

      expect(tts.synthesizeCalls).not.toContain("Second part that should never be heard.");
    });
  });

  /**
   * C1 — a real call's ENTIRE model output for one turn was the literal
   * 7-character string "[pause]", no words at all. `parseDelivery`
   * correctly recognized nothing was left to speak once the cue was
   * stripped, but the OLD `speak()` just returned — meaning ~12 real
   * seconds of total silence, right before the caller said "i'm just
   * pissed right now." These prove the deterministic code-level guard:
   * `speak()` never produces true silence, no matter what text it's
   * given, while a cue immediately followed by real words is completely
   * unaffected.
   */
  describe("silent-response guard — speak() never produces total silence — C1", () => {
    const FALLBACK_PHRASES = ["I'm here.", "I'm listening.", "Go ahead.", "I'm with you."];

    it("MISSION EXAMPLE: a response that is ONLY '[pause]' — no words at all — speaks a real fallback phrase instead of nothing", async () => {
      const { orchestrator, orchestratorClient, stt, tts, sink } = buildOrchestratorWithSink();
      orchestratorClient.turnResponses = [
        {
          conversationId: "conv-1",
          responseText: "[pause]",
          toolCallsExecuted: [],
          interrupted: false,
          state: "qualifying",
        },
      ];
      await orchestrator.onCallStart(baseParams(), sink);
      stt.sessions[0]!.emitFinalTranscript("i know you are here", 0.9);
      await flushMicrotasks();

      const turnCalls = tts.synthesizeCalls.slice(1); // drop the greeting
      expect(turnCalls).toHaveLength(1);
      expect(FALLBACK_PHRASES).toContain(turnCalls[0]);
      // Never the literal cue text, in any form.
      expect(turnCalls[0]).not.toMatch(/[[\]]/);
    });

    it("a response that is ONLY an emotion cue ('[warmly]', no words) also gets a real fallback, not silence", async () => {
      const { orchestrator, orchestratorClient, stt, tts, sink } = buildOrchestratorWithSink();
      orchestratorClient.turnResponses = [
        {
          conversationId: "conv-1",
          responseText: "[warmly]",
          toolCallsExecuted: [],
          interrupted: false,
          state: "qualifying",
        },
      ];
      await orchestrator.onCallStart(baseParams(), sink);
      stt.sessions[0]!.emitFinalTranscript("hello", 0.9);
      await flushMicrotasks();

      const turnCalls = tts.synthesizeCalls.slice(1);
      expect(turnCalls).toHaveLength(1);
      expect(FALLBACK_PHRASES).toContain(turnCalls[0]);
    });

    it("a whitespace-only response gets a real fallback, not silence", async () => {
      const { orchestrator, orchestratorClient, stt, tts, sink } = buildOrchestratorWithSink();
      orchestratorClient.turnResponses = [
        {
          conversationId: "conv-1",
          responseText: "   \n  ",
          toolCallsExecuted: [],
          interrupted: false,
          state: "qualifying",
        },
      ];
      await orchestrator.onCallStart(baseParams(), sink);
      stt.sessions[0]!.emitFinalTranscript("hello", 0.9);
      await flushMicrotasks();

      const turnCalls = tts.synthesizeCalls.slice(1);
      expect(turnCalls).toHaveLength(1);
      expect(FALLBACK_PHRASES).toContain(turnCalls[0]);
    });

    it("markup-only (unsupported tag, no real words) gets a real fallback, not silence", async () => {
      const { orchestrator, orchestratorClient, stt, tts, sink } = buildOrchestratorWithSink();
      orchestratorClient.turnResponses = [
        {
          conversationId: "conv-1",
          responseText: "[excitedly]",
          toolCallsExecuted: [],
          interrupted: false,
          state: "qualifying",
        },
      ];
      await orchestrator.onCallStart(baseParams(), sink);
      stt.sessions[0]!.emitFinalTranscript("hello", 0.9);
      await flushMicrotasks();

      const turnCalls = tts.synthesizeCalls.slice(1);
      expect(turnCalls).toHaveLength(1);
      expect(FALLBACK_PHRASES).toContain(turnCalls[0]);
    });

    it("does NOT rotate through the same fallback phrase twice in a row — round-robins across repeated silent turns in the same call", async () => {
      const { orchestrator, orchestratorClient, stt, tts, sink } = buildOrchestratorWithSink();
      orchestratorClient.turnResponses = [
        {
          conversationId: "conv-1",
          responseText: "[pause]",
          toolCallsExecuted: [],
          interrupted: false,
          state: "qualifying",
        },
        {
          conversationId: "conv-1",
          responseText: "[pause]",
          toolCallsExecuted: [],
          interrupted: false,
          state: "qualifying",
        },
      ];
      await orchestrator.onCallStart(baseParams(), sink);
      stt.sessions[0]!.emitFinalTranscript("first", 0.9);
      await flushMicrotasks();
      stt.sessions[0]!.emitFinalTranscript("second", 0.9);
      await flushMicrotasks();

      const turnCalls = tts.synthesizeCalls.slice(1);
      expect(turnCalls).toHaveLength(2);
      expect(turnCalls[0]).not.toBe(turnCalls[1]);
    });

    it("REGRESSION: a cue immediately followed by real words is completely unaffected — no fallback substitution, no double-speaking", async () => {
      const { orchestrator, orchestratorClient, stt, tts, sink } = buildOrchestratorWithSink();
      orchestratorClient.turnResponses = [
        {
          conversationId: "conv-1",
          responseText: "[sincere] I'm sorry you're dealing with that.",
          toolCallsExecuted: [],
          interrupted: false,
          state: "qualifying",
        },
      ];
      await orchestrator.onCallStart(baseParams(), sink);
      stt.sessions[0]!.emitFinalTranscript("this is broken", 0.9);
      await flushMicrotasks();

      const turnCalls = tts.synthesizeCalls.slice(1);
      expect(turnCalls).toEqual(["I'm sorry you're dealing with that."]);
      expect(FALLBACK_PHRASES).not.toContain(turnCalls[0]);
    });

    it("REGRESSION: a normal, plain-text response is completely unaffected", async () => {
      const { orchestrator, orchestratorClient, stt, tts, sink } = buildOrchestratorWithSink();
      orchestratorClient.turnResponses = [
        {
          conversationId: "conv-1",
          responseText: "Got it, what's the issue?",
          toolCallsExecuted: [],
          interrupted: false,
          state: "qualifying",
        },
      ];
      await orchestrator.onCallStart(baseParams(), sink);
      stt.sessions[0]!.emitFinalTranscript("hi", 0.9);
      await flushMicrotasks();

      const turnCalls = tts.synthesizeCalls.slice(1);
      expect(turnCalls).toEqual(["Got it, what's the issue?"]);
    });
  });

  /**
   * H1 — a real call showed Deepgram's own endpointing (500ms silence)
   * correctly, per its own threshold, finalizing a caller's still-forming
   * thought as its own complete, independent turn — at least 3 confirmed
   * instances, one directly correlating with the caller's own explicit
   * complaint about being talked over. `looksLikeIncompleteFragment`
   * (fragment-detector.ts) plus a bounded coalescing window
   * (`FRAGMENT_COALESCE_WINDOW_MS`) merges a real continuation into one
   * turn instead of two, while leaving normal-length and normal-sounding
   * short utterances exactly as responsive as before.
   */
  describe("fragment coalescing (looksLikeIncompleteFragment / FRAGMENT_COALESCE_WINDOW_MS) — H1", () => {
    // These tests advance fake time by up to a few seconds to exercise
    // the coalescing window itself — the file's own top-level beforeEach
    // sets SILENCE_CHECK_IN_TIMEOUT_MS to 5ms (to avoid dangling REAL
    // timers in tests that don't otherwise care about it), which would
    // otherwise spuriously fire mid-test here. A large value keeps it
    // out of the way without disabling it outright.
    const originalSilenceTimeout = process.env["SILENCE_CHECK_IN_TIMEOUT_MS"];
    beforeEach(() => {
      process.env["SILENCE_CHECK_IN_TIMEOUT_MS"] = "60000";
    });
    afterEach(() => {
      if (originalSilenceTimeout === undefined) {
        delete process.env["SILENCE_CHECK_IN_TIMEOUT_MS"];
      } else {
        process.env["SILENCE_CHECK_IN_TIMEOUT_MS"] = originalSilenceTimeout;
      }
    });

    it("MISSION EXAMPLE: 'can you' + 'answer my question first' arriving within the window become ONE turn, not two", async () => {
      jest.useFakeTimers();
      try {
        const { orchestrator, orchestratorClient, stt, tts, sink } = buildOrchestratorWithSink();
        orchestratorClient.turnResponses = [
          {
            conversationId: "conv-1",
            responseText: "Sure — go ahead.",
            toolCallsExecuted: [],
            interrupted: false,
            state: "qualifying",
          },
        ];
        await orchestrator.onCallStart(baseParams(), sink);
        const session = stt.sessions[0]!;

        session.emitFinalTranscript("can you", 1.0);
        await jest.advanceTimersByTimeAsync(600);
        session.emitFinalTranscript("answer my question first", 0.999);
        await jest.advanceTimersByTimeAsync(1300);

        expect(orchestratorClient.turnCalls).toHaveLength(1);
        expect(orchestratorClient.turnCalls[0]?.req.transcript).toBe(
          "can you answer my question first",
        );
        expect(tts.synthesizeCalls.slice(1)).toEqual(["Sure — go ahead."]);
      } finally {
        jest.useRealTimers();
      }
    });

    it("a fragment-looking utterance with NOTHING following commits alone once the window elapses — never lost, just delayed", async () => {
      jest.useFakeTimers();
      try {
        const { orchestrator, orchestratorClient, stt, sink } = buildOrchestratorWithSink();
        orchestratorClient.turnResponses = [
          {
            conversationId: "conv-1",
            responseText: "Go ahead, I'm listening.",
            toolCallsExecuted: [],
            interrupted: false,
            state: "qualifying",
          },
        ];
        await orchestrator.onCallStart(baseParams(), sink);
        const session = stt.sessions[0]!;

        session.emitFinalTranscript("can you", 1.0);
        await jest.advanceTimersByTimeAsync(500);
        expect(orchestratorClient.turnCalls).toHaveLength(0); // still waiting

        await jest.advanceTimersByTimeAsync(800); // crosses the 1200ms window
        expect(orchestratorClient.turnCalls).toHaveLength(1);
        expect(orchestratorClient.turnCalls[0]?.req.transcript).toBe("can you");
      } finally {
        jest.useRealTimers();
      }
    });

    it("MISSION EXAMPLE: a genuinely complete short answer ('yeah') is NOT flagged as a fragment — commits immediately, zero added latency", async () => {
      const { orchestrator, orchestratorClient, stt, sink } = buildOrchestratorWithSink();
      orchestratorClient.turnResponses = [
        {
          conversationId: "conv-1",
          responseText: "Got it.",
          toolCallsExecuted: [],
          interrupted: false,
          state: "qualifying",
        },
      ];
      await orchestrator.onCallStart(baseParams(), sink);
      stt.sessions[0]!.emitFinalTranscript("yeah", 0.95);
      await flushMicrotasks(); // no timer advance at all — proves zero added delay

      expect(orchestratorClient.turnCalls).toHaveLength(1);
      expect(orchestratorClient.turnCalls[0]?.req.transcript).toBe("yeah");
      // This describe block's own SILENCE_CHECK_IN_TIMEOUT_MS=60000
      // override (needed by the other tests here, which advance fake
      // time by seconds) would otherwise leave a real, dangling 60s
      // setTimeout armed after this specific test — the only one in
      // this block that never advances any timer, fake or real.
      await orchestrator.onCallEnd(baseParams(), "caller_hangup");
    });

    it("MISSION EXAMPLE: 'yes' now, then a genuinely separate 'what's your address' well after the window, stay TWO separate turns", async () => {
      jest.useFakeTimers();
      try {
        const { orchestrator, orchestratorClient, stt, sink } = buildOrchestratorWithSink();
        orchestratorClient.turnResponses = [
          {
            conversationId: "conv-1",
            responseText: "Got it.",
            toolCallsExecuted: [],
            interrupted: false,
            state: "qualifying",
          },
          {
            conversationId: "conv-1",
            responseText: "Thanks.",
            toolCallsExecuted: [],
            interrupted: false,
            state: "qualifying",
          },
        ];
        await orchestrator.onCallStart(baseParams(), sink);
        const session = stt.sessions[0]!;

        session.emitFinalTranscript("yes", 0.95);
        await jest.advanceTimersByTimeAsync(0);
        expect(orchestratorClient.turnCalls).toHaveLength(1); // "yes" isn't flagged — commits immediately

        // A real gap, well after any coalescing window, before the caller
        // asks something new and unrelated.
        await jest.advanceTimersByTimeAsync(5000);
        session.emitFinalTranscript("what's your address", 0.98);
        await jest.advanceTimersByTimeAsync(0);

        expect(orchestratorClient.turnCalls).toHaveLength(2);
        expect(orchestratorClient.turnCalls[1]?.req.transcript).toBe("what's your address");
      } finally {
        jest.useRealTimers();
      }
    });

    it("a chain of 3 short fragments arriving close together all merge into ONE turn — the coalescing window re-arms on each new fragment", async () => {
      jest.useFakeTimers();
      try {
        const { orchestrator, orchestratorClient, stt, sink } = buildOrchestratorWithSink();
        orchestratorClient.turnResponses = [
          {
            conversationId: "conv-1",
            responseText: "Got it.",
            toolCallsExecuted: [],
            interrupted: false,
            state: "qualifying",
          },
        ];
        await orchestrator.onCallStart(baseParams(), sink);
        const session = stt.sessions[0]!;

        session.emitFinalTranscript("oh sorry like", 0.9);
        await jest.advanceTimersByTimeAsync(700);
        session.emitFinalTranscript("i was fixing my", 0.99);
        await jest.advanceTimersByTimeAsync(700);
        session.emitFinalTranscript("water heater", 0.95);
        await jest.advanceTimersByTimeAsync(1300);

        expect(orchestratorClient.turnCalls).toHaveLength(1);
        expect(orchestratorClient.turnCalls[0]?.req.transcript).toBe(
          "oh sorry like i was fixing my water heater",
        );
      } finally {
        jest.useRealTimers();
      }
    });

    it("barge-in still fires correctly (existing mechanism, untouched) while an UNRELATED fragment coalescing window is pending on the NEXT turn", async () => {
      jest.useFakeTimers();
      try {
        const { orchestrator, orchestratorClient, stt, tts, sink } = buildOrchestratorWithSink();
        orchestratorClient.hangTurnUntilAborted = true;
        await orchestrator.onCallStart(baseParams(), sink);
        const session = stt.sessions[0]!;

        // A normal (non-fragment) turn starts and hangs, mid-flight.
        session.emitFinalTranscript("my water heater is broken", 0.95);
        await jest.advanceTimersByTimeAsync(0);
        const turnSignal = orchestratorClient.turnCalls[0]?.signal;
        expect(turnSignal?.aborted).toBe(false);

        // The caller barges in with real confirmed speech — the EXISTING
        // barge-in mechanism (handleSpeechStarted/handleInterimSpeech),
        // completely independent of fragment coalescing.
        session.emitSpeechStarted();
        session.emitInterimSpeech("wait, hold on");
        await jest.advanceTimersByTimeAsync(0);

        expect(turnSignal?.aborted).toBe(true);
        void tts;
      } finally {
        jest.useRealTimers();
      }
    });

    it("onCallEnd cleans up a pending fragment safely — no dangling timer, nothing spoken after the call ends", async () => {
      jest.useFakeTimers();
      try {
        const { orchestrator, orchestratorClient, stt, sink } = buildOrchestratorWithSink();
        await orchestrator.onCallStart(baseParams(), sink);
        const session = stt.sessions[0]!;

        session.emitFinalTranscript("can you", 1.0);
        await jest.advanceTimersByTimeAsync(0);
        expect(orchestratorClient.turnCalls).toHaveLength(0); // pending, waiting

        await orchestrator.onCallEnd(baseParams(), "caller_hangup");
        await jest.advanceTimersByTimeAsync(2000); // well past the window

        expect(orchestratorClient.turnCalls).toHaveLength(0); // never committed
      } finally {
        jest.useRealTimers();
      }
    });

    it("two concurrent calls each pending a fragment never merge into each other's turn (per-instance state, not shared)", async () => {
      // Each live call gets its own TRANSIENT CallSessionOrchestrator
      // instance in production (see call-session-orchestrator.scope.spec.ts
      // for the DI-scope proof itself) — this test proves the FRAGMENT
      // fields specifically (pendingFragment/fragmentCoalesceTimer) behave
      // correctly under that model, using two directly-constructed
      // instances the same way the existing silence-timer isolation test
      // above does.
      jest.useFakeTimers();
      try {
        const callA = buildOrchestratorWithSink();
        const callB = buildOrchestratorWithSink();
        callA.orchestratorClient.turnResponses = [
          {
            conversationId: "conv-a",
            responseText: "Got it, A.",
            toolCallsExecuted: [],
            interrupted: false,
            state: "qualifying",
          },
        ];
        callB.orchestratorClient.turnResponses = [
          {
            conversationId: "conv-b",
            responseText: "Got it, B.",
            toolCallsExecuted: [],
            interrupted: false,
            state: "qualifying",
          },
        ];

        await callA.orchestrator.onCallStart(baseParams({ callId: "call-a" }), callA.sink);
        await callB.orchestrator.onCallStart(baseParams({ callId: "call-b" }), callB.sink);

        // Both calls leave a fragment pending at the same moment.
        callA.stt.sessions[0]!.emitFinalTranscript("can you", 1.0);
        callB.stt.sessions[0]!.emitFinalTranscript("i was fixing my", 0.9);
        await jest.advanceTimersByTimeAsync(0);
        expect(callA.orchestratorClient.turnCalls).toHaveLength(0);
        expect(callB.orchestratorClient.turnCalls).toHaveLength(0);

        // Only call A's fragment is completed by a follow-up piece.
        callA.stt.sessions[0]!.emitFinalTranscript("answer my question first", 0.99);
        await jest.advanceTimersByTimeAsync(1300); // past the window for both

        expect(callA.orchestratorClient.turnCalls).toHaveLength(1);
        expect(callA.orchestratorClient.turnCalls[0]?.req.transcript).toBe(
          "can you answer my question first",
        );
        // Call B's fragment must commit on its OWN, unmerged with A's text
        // or A's timer — proving the fields are per-instance, not shared
        // module-level state.
        expect(callB.orchestratorClient.turnCalls).toHaveLength(1);
        expect(callB.orchestratorClient.turnCalls[0]?.req.transcript).toBe("i was fixing my");
      } finally {
        jest.useRealTimers();
      }
    });

    it("low STT confidence never changes fragment-coalescing behavior — the heuristic reads only transcript shape, not confidence", async () => {
      // Confidence-driven handling (annotateLowConfidenceTranscript) is a
      // separate, later concern in voice-orchestrator's own prompt layer —
      // waiting longer for more audio doesn't make a misheard WORD any
      // clearer, so fragment coalescing must not treat low confidence as
      // its own signal to wait, nor skip waiting for a low-confidence
      // fragment-shaped piece. Both directions are asserted here.
      jest.useFakeTimers();
      try {
        const { orchestrator, orchestratorClient, stt, sink } = buildOrchestratorWithSink();
        orchestratorClient.turnResponses = [
          {
            conversationId: "conv-1",
            responseText: "Got it.",
            toolCallsExecuted: [],
            interrupted: false,
            state: "qualifying",
          },
          {
            conversationId: "conv-1",
            responseText: "Go ahead.",
            toolCallsExecuted: [],
            interrupted: false,
            state: "qualifying",
          },
        ];
        await orchestrator.onCallStart(baseParams(), sink);
        const session = stt.sessions[0]!;

        // A complete-looking utterance at very LOW confidence still
        // commits immediately — low confidence alone never triggers a
        // coalescing wait.
        session.emitFinalTranscript("yeah", 0.15);
        await jest.advanceTimersByTimeAsync(0);
        expect(orchestratorClient.turnCalls).toHaveLength(1);
        expect(orchestratorClient.turnCalls[0]?.req.transcript).toBe("yeah");

        // A fragment-shaped utterance at very low confidence is still
        // coalesced exactly like a high-confidence one — no separate
        // low-confidence code path skips the wait.
        session.emitFinalTranscript("can you", 0.2);
        await jest.advanceTimersByTimeAsync(500);
        expect(orchestratorClient.turnCalls).toHaveLength(1); // still waiting
        await jest.advanceTimersByTimeAsync(800);
        expect(orchestratorClient.turnCalls).toHaveLength(2);
        expect(orchestratorClient.turnCalls[1]?.req.transcript).toBe("can you");
      } finally {
        jest.useRealTimers();
      }
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

    /**
     * FOUND LIVE via a full-stack audit (verified the real Twilio
     * call-modification REST call is correctly authenticated/formed
     * against the live API, then traced the failure path): neither this
     * case (no destination configured) nor a genuinely thrown
     * `transferCall` error used to speak anything to the caller or
     * re-arm the silence check-in — a failed transfer during a REAL
     * emergency (the docs' own example: a gas leak) left the caller in
     * indefinite silence with no fallback and no safety net. This and
     * the next test prove the fix for both failure paths.
     */
    it("speaks an honest fallback and re-arms the silence check-in when no transfer destination is configured at all — never leaves the caller in silence during a real emergency", async () => {
      delete process.env["EMERGENCY_TRANSFER_NUMBER"];
      jest.useFakeTimers();
      try {
        const { orchestrator, orchestratorClient, stt, callTransfer, tts } =
          buildOrchestratorUnderTest();
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
        await jest.advanceTimersByTimeAsync(0);

        expect(callTransfer.transferCalls).toHaveLength(0);
        expect(tts.synthesizeCalls).toContain(
          "I wasn't able to connect you directly — let me get your information so we can get someone out to you as fast as possible.",
        );
        // The silence check-in is now armed — the same real safety net a
        // normal (non-transfer) turn already gets, proving the caller
        // isn't stranded with no way for the system to ever check in again.
        process.env["SILENCE_CHECK_IN_TIMEOUT_MS"] = "5";
        await jest.advanceTimersByTimeAsync(10);
        expect(tts.synthesizeCalls).toContain("Take your time. I'm still here.");
      } finally {
        jest.useRealTimers();
      }
    });

    it("speaks an honest fallback and re-arms the silence check-in when the real Twilio transfer call itself throws", async () => {
      const { orchestrator, orchestratorClient, stt, callTransfer, tts } =
        buildOrchestratorUnderTest();
      const sink = new FakeMediaStreamSink();
      process.env["EMERGENCY_TRANSFER_NUMBER"] = "+15559990000";
      callTransfer.failNextWith = new Error("Twilio call-transfer failed (500): internal error");
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
      session.emitFinalTranscript("gas smell near the water heater", 0.9);
      await flushMicrotasks();

      expect(callTransfer.transferCalls).toHaveLength(1); // the attempt WAS made, it just failed
      expect(tts.synthesizeCalls).toContain(
        "I wasn't able to connect you directly — let me get your information so we can get someone out to you as fast as possible.",
      );
      // Never claims a transfer that didn't happen.
      expect(tts.synthesizeCalls).not.toContain("Connecting you directly now.");
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

  /**
   * The non-emergency counterpart to "emergency escalation" above — same
   * executeTransfer code path, same static-fallback and honest-failure
   * contract, exercised through the separate `humanTransfer` signal
   * instead of `escalation.action === "forward_call"`. See
   * TransferToHumanUseCase's own comment (core-api) for why this is a
   * distinct tool/signal rather than a variant of emergency escalation.
   */
  describe("human transfer", () => {
    it("executes a call transfer when a turn result signals humanTransfer", async () => {
      process.env["HUMAN_FALLBACK_NUMBER"] = "+15559990000";
      const { orchestrator, orchestratorClient, stt, callTransfer } = buildOrchestratorUnderTest();
      const sink = new FakeMediaStreamSink();
      orchestratorClient.turnResponses = [
        {
          conversationId: "conv-1",
          responseText: "One sec, let me get you over to the team.",
          toolCallsExecuted: ["transferToHuman"],
          interrupted: false,
          state: "qualifying",
          humanTransfer: { reason: "caller_requested", transferDestination: null },
        },
      ];

      await orchestrator.onCallStart(baseParams({ callSid: "CA-human-transfer" }), sink);
      const session = stt.sessions[0]!;
      session.emitFinalTranscript("can I talk to a real person please", 0.9);
      await flushMicrotasks();

      expect(callTransfer.transferCalls).toHaveLength(1);
      expect(callTransfer.transferCalls[0]).toEqual({
        callSid: "CA-human-transfer",
        destination: "+15559990000",
      });
    });

    it("prefers the server-resolved on-call destination over the static HUMAN_FALLBACK_NUMBER when both are available", async () => {
      process.env["HUMAN_FALLBACK_NUMBER"] = "+15559990000";
      const { orchestrator, orchestratorClient, stt, callTransfer } = buildOrchestratorUnderTest();
      const sink = new FakeMediaStreamSink();
      orchestratorClient.turnResponses = [
        {
          conversationId: "conv-1",
          responseText: "One sec, let me get you over to the team.",
          toolCallsExecuted: ["transferToHuman"],
          interrupted: false,
          state: "qualifying",
          humanTransfer: { reason: "caller_requested", transferDestination: "+15551230000" },
        },
      ];

      await orchestrator.onCallStart(baseParams({ callSid: "CA-human-oncall" }), sink);
      const session = stt.sessions[0]!;
      session.emitFinalTranscript("can I talk to a real person please", 0.9);
      await flushMicrotasks();

      expect(callTransfer.transferCalls).toHaveLength(1);
      expect(callTransfer.transferCalls[0]).toEqual({
        callSid: "CA-human-oncall",
        destination: "+15551230000",
      });
    });

    it("speaks an honest fallback and re-arms the silence check-in when no destination is configured at all — never claims a transfer that didn't happen", async () => {
      delete process.env["HUMAN_FALLBACK_NUMBER"];
      delete process.env["EMERGENCY_TRANSFER_NUMBER"];
      const { orchestrator, orchestratorClient, stt, callTransfer, tts } =
        buildOrchestratorUnderTest();
      const sink = new FakeMediaStreamSink();
      orchestratorClient.turnResponses = [
        {
          conversationId: "conv-1",
          responseText: "One sec, let me get you over to the team.",
          toolCallsExecuted: ["transferToHuman"],
          interrupted: false,
          state: "qualifying",
          humanTransfer: { reason: "caller_requested", transferDestination: null },
        },
      ];

      await orchestrator.onCallStart(baseParams(), sink);
      const session = stt.sessions[0]!;
      session.emitFinalTranscript("can I talk to a real person please", 0.9);
      await flushMicrotasks();

      expect(callTransfer.transferCalls).toHaveLength(0);
      expect(tts.synthesizeCalls.some((t) => /wasn'?t able to reach the team/i.test(t))).toBe(true);
      expect(tts.synthesizeCalls.every((t) => !/you'?re (now )?connected/i.test(t))).toBe(true);
    });

    it("does not attempt a transfer when no turn result signals humanTransfer", async () => {
      const { orchestrator, orchestratorClient, stt, callTransfer } = buildOrchestratorUnderTest();
      const sink = new FakeMediaStreamSink();
      orchestratorClient.turnResponses = [
        {
          conversationId: "conv-1",
          responseText: "Sure, what's going on with it?",
          toolCallsExecuted: [],
          interrupted: false,
          state: "qualifying",
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

  /**
   * Found live on a real ~21-minute call: several gaps of 33-89 seconds
   * with no check-in at all. An audit confirmed there was no such
   * mechanism ANYWHERE in this codebase to begin with — no prior
   * "one-time vs repeating" behavior existed to preserve. These tests
   * exercise the new one, added specifically to close that gap without
   * ever nagging, interrupting active speech, or firing during system
   * processing.
   */
  describe("silence check-in (SILENCE_CHECK_IN_TIMEOUT_MS)", () => {
    beforeEach(() => {
      process.env["SILENCE_CHECK_IN_TIMEOUT_MS"] = "1000";
    });

    it("fires a one-time check-in after the caller has been completely silent for the full timeout following the greeting", async () => {
      jest.useFakeTimers();
      try {
        const { orchestrator, tts } = buildOrchestratorUnderTest();
        const sink = new FakeMediaStreamSink();

        await orchestrator.onCallStart(baseParams(), sink);
        expect(tts.synthesizeCalls).toEqual(["Thanks for calling, how can I help?"]);

        await jest.advanceTimersByTimeAsync(1000);

        expect(tts.synthesizeCalls).toEqual([
          "Thanks for calling, how can I help?",
          "Take your time. I'm still here.",
        ]);
      } finally {
        jest.useRealTimers();
      }
    });

    it("CLIENT FEEDBACK: does NOT speak over a caller who is audibly mid-speech when the timer expires, and still checks in once they go quiet", async () => {
      jest.useFakeTimers();
      try {
        const { orchestrator, stt, tts } = buildOrchestratorUnderTest();
        const sink = new FakeMediaStreamSink();

        await orchestrator.onCallStart(baseParams(), sink);
        // A long speech: raw sound right before the timer expires, with no
        // recognized interim text yet (STT lag), so nothing disarmed it.
        await jest.advanceTimersByTimeAsync(900);
        stt.sessions[0]!.emitSpeechStarted();
        await jest.advanceTimersByTimeAsync(100); // timer expires here

        expect(tts.synthesizeCalls).toEqual(["Thanks for calling, how can I help?"]);

        // Caller goes quiet: the deferred check-in still happens.
        await jest.advanceTimersByTimeAsync(2000);
        expect(tts.synthesizeCalls).toContain("Take your time. I'm still here.");
      } finally {
        jest.useRealTimers();
      }
    });

    it("does NOT fire when the caller responds before the timeout", async () => {
      jest.useFakeTimers();
      try {
        const { orchestrator, orchestratorClient, stt, tts } = buildOrchestratorUnderTest();
        const sink = new FakeMediaStreamSink();
        orchestratorClient.turnResponses = [
          {
            conversationId: "conv-1",
            responseText: "Got it, what's the issue?",
            toolCallsExecuted: [],
            interrupted: false,
            state: "qualifying",
          },
        ];

        await orchestrator.onCallStart(baseParams(), sink);
        await jest.advanceTimersByTimeAsync(500); // well within the 1000ms window

        const session = stt.sessions[0]!;
        session.emitFinalTranscript("my sink is leaking", 0.9);
        await jest.advanceTimersByTimeAsync(0);

        // The check-in that would have fired from the ORIGINAL window
        // (which ends at 1000ms) must not have snuck through — the
        // response arriving at 500ms disarmed it. A check-in DOES
        // correctly re-arm for the caller's real response having been
        // spoken (a genuinely new, later episode — covered by its own
        // test below), so this only asserts what matters here: no
        // check-in fired from the original pending window specifically.
        expect(tts.synthesizeCalls).toEqual([
          "Thanks for calling, how can I help?",
          "Got it, what's the issue?",
        ]);
      } finally {
        jest.useRealTimers();
      }
    });

    it("the FIRST check-in phrase specifically does NOT repeat verbatim — continued silence escalates to a different phrase instead (see the REPEATS test below for the full mechanism)", async () => {
      jest.useFakeTimers();
      try {
        const { orchestrator, tts } = buildOrchestratorUnderTest();
        const sink = new FakeMediaStreamSink();

        await orchestrator.onCallStart(baseParams(), sink);
        await jest.advanceTimersByTimeAsync(1000);
        expect(
          tts.synthesizeCalls.filter((t) => t === "Take your time. I'm still here.").length,
        ).toBe(1);

        await jest.advanceTimersByTimeAsync(5000); // stay silent much longer
        expect(
          tts.synthesizeCalls.filter((t) => t === "Take your time. I'm still here.").length,
        ).toBe(1); // still just the one — later check-ins use a different phrase, not a repeat of this one
      } finally {
        jest.useRealTimers();
      }
    });

    /**
     * REAL-CALL FINDING: a real prospective client's test call had his
     * speech finalizing as EMPTY Deepgram transcripts throughout (poor
     * line quality) — Grace never heard a turn, so from his side the
     * line looked dead. The ORIGINAL one-shot check-in gave him exactly
     * one reassurance in the whole silent stretch before he gave up and
     * hung up saying "can you hear me grace". This proves the actual
     * fix: continued silence now gets MORE check-ins, escalating to a
     * phrase that names the likely real cause (not hearing him), capped
     * so a caller who genuinely walked away isn't talked at forever.
     */
    it("REPEATS the check-in on continued silence, escalating to the 'might not be hearing you' phrase, capped at MAX_SILENCE_CHECK_INS", async () => {
      jest.useFakeTimers();
      try {
        const { orchestrator, tts } = buildOrchestratorUnderTest();
        const sink = new FakeMediaStreamSink();

        await orchestrator.onCallStart(baseParams(), sink);

        await jest.advanceTimersByTimeAsync(1000); // 1st check-in
        await jest.advanceTimersByTimeAsync(1000); // 2nd
        await jest.advanceTimersByTimeAsync(1000); // would be a 3rd, but the cap is 2

        const troubleHearingCount = tts.synthesizeCalls.filter((t) =>
          t.includes("might not be hearing you"),
        ).length;
        expect(
          tts.synthesizeCalls.filter((t) => t === "Take your time. I'm still here.").length,
        ).toBe(1);
        expect(troubleHearingCount).toBe(1); // check-in 2 only

        // Confirms the cap actually holds — no 3rd check-in, of either
        // phrase. Lowered from 3 to 2 after real-call feedback that she
        // was speaking up far too often; two is enough to signal "I'm
        // here and might not be hearing you" without nagging.
        expect(tts.synthesizeCalls.length).toBe(3); // greeting + 2 check-ins, nothing more
      } finally {
        jest.useRealTimers();
      }
    });

    it("a REAL Grace utterance (not just continued silence) resets the repeat budget for a genuinely new silence episode", async () => {
      jest.useFakeTimers();
      try {
        const { orchestrator, orchestratorClient, stt, tts } = buildOrchestratorUnderTest();
        const sink = new FakeMediaStreamSink();
        orchestratorClient.turnResponses = [
          {
            conversationId: "conv-1",
            responseText: "Got it, what's the issue?",
            toolCallsExecuted: [],
            interrupted: false,
            state: "qualifying",
          },
        ];

        await orchestrator.onCallStart(baseParams(), sink);
        await jest.advanceTimersByTimeAsync(1000); // 1st check-in
        await jest.advanceTimersByTimeAsync(1000); // 2nd check-in (budget now at 2/3)

        // The caller finally responds — a real Grace reply re-arms with a
        // FRESH budget, not a continuation of the old one.
        const session = stt.sessions[0]!;
        session.emitFinalTranscript("my sink is leaking", 0.9);
        await jest.advanceTimersByTimeAsync(0);

        await jest.advanceTimersByTimeAsync(1000); // 1st check-in of the NEW episode
        expect(
          tts.synthesizeCalls.filter((t) => t === "Take your time. I'm still here.").length,
        ).toBe(2); // one from each episode's own first check-in, not blocked by the earlier episode's budget
      } finally {
        jest.useRealTimers();
      }
    });

    it("does NOT fire while a turn is actively processing, even well past the timeout — system latency is not caller silence", async () => {
      jest.useFakeTimers();
      try {
        const { orchestrator, orchestratorClient, stt, tts } = buildOrchestratorUnderTest();
        const sink = new FakeMediaStreamSink();
        orchestratorClient.hangTurnUntilAborted = true;

        await orchestrator.onCallStart(baseParams(), sink);
        const session = stt.sessions[0]!;
        session.emitFinalTranscript("my sink is leaking", 0.9);
        await jest.advanceTimersByTimeAsync(0);

        await jest.advanceTimersByTimeAsync(5000); // the turn is still hanging
        expect(tts.synthesizeCalls).not.toContain("Take your time. I'm still here.");
      } finally {
        jest.useRealTimers();
      }
    });

    it("does NOT fire during an emergency call transfer", async () => {
      jest.useFakeTimers();
      try {
        process.env["EMERGENCY_TRANSFER_NUMBER"] = "+15559990000";
        const { orchestrator, orchestratorClient, stt, tts } = buildOrchestratorUnderTest();
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
              transferDestination: null,
            },
          },
        ];

        await orchestrator.onCallStart(baseParams({ callSid: "CA-emergency" }), sink);
        const session = stt.sessions[0]!;
        session.emitFinalTranscript("burst pipe flooding my basement", 0.9);
        await jest.advanceTimersByTimeAsync(0);

        await jest.advanceTimersByTimeAsync(5000);
        expect(tts.synthesizeCalls).not.toContain("Take your time. I'm still here.");
      } finally {
        jest.useRealTimers();
      }
    });

    /**
     * Found live on a real ~2.5-minute call: a bare VAD SpeechStarted
     * blip with NO recognized content fired every 1-3 seconds for a
     * continuous 37-second stretch (Deepgram's own event log:
     * transcriptLength: 0 on nearly every one) — almost certainly
     * background noise, not the caller. The FIRST version of this fix
     * reset the silence check-in on every one of those, on the reasoning
     * that "any detected audio proves presence" — which meant the
     * check-in essentially never got a clean window to fire in an
     * environment with any ambient noise at all; the caller eventually
     * had to say "hey grace i'm waiting for a reply" because it never
     * checked in. A bare, content-free blip now does NOT reset the
     * timer — only `handleInterimSpeech` (real recognized text) does.
     */
    it("a bare SpeechStarted blip with no recognized content only DEFERS the check-in by one grace window — it never cancels or resets it", async () => {
      jest.useFakeTimers();
      try {
        const { orchestrator, stt, tts } = buildOrchestratorUnderTest();
        const sink = new FakeMediaStreamSink();

        await orchestrator.onCallStart(baseParams(), sink);
        const session = stt.sessions[0]!;

        // A content-free blip at t=800ms — should NOT push the check-in
        // out any further than its original 1000ms schedule.
        await jest.advanceTimersByTimeAsync(800);
        session.emitSpeechStarted();
        await jest.advanceTimersByTimeAsync(0);

        // Client feedback changed this: a caller may be mid-speech with no
        // recognized text yet, so the check-in holds off at the original
        // mark rather than talk over them...
        await jest.advanceTimersByTimeAsync(200);
        expect(tts.synthesizeCalls).not.toContain("Take your time. I'm still here.");
        // ...but only by one grace window; a blip never cancels it.
        await jest.advanceTimersByTimeAsync(1000);
        expect(tts.synthesizeCalls).toContain("Take your time. I'm still here.");
      } finally {
        jest.useRealTimers();
      }
    });

    it("continuous content-free SpeechStarted blips (simulating background noise) only defer the check-in a bounded number of times, then it still fires — never silenced forever", async () => {
      jest.useFakeTimers();
      try {
        const { orchestrator, stt, tts } = buildOrchestratorUnderTest();
        const sink = new FakeMediaStreamSink();

        await orchestrator.onCallStart(baseParams(), sink);
        const session = stt.sessions[0]!;

        // A blip every 300ms for the whole window — if a bare blip reset
        // the timer (the old, disproven behavior), this would push the
        // check-in out indefinitely, exactly as it did on the real call.
        for (let elapsed = 0; elapsed < 900; elapsed += 300) {
          await jest.advanceTimersByTimeAsync(300);
          session.emitSpeechStarted();
        }
        await jest.advanceTimersByTimeAsync(100); // crosses the original 1000ms mark
        expect(tts.synthesizeCalls).not.toContain("Take your time. I'm still here.");

        // Noise continues, but deferral is capped (MAX_SILENCE_CHECK_IN_DEFERRALS),
        // so the check-in still fires: the real-call failure of a check-in
        // that never arrives stays closed.
        for (let elapsed = 0; elapsed < 6000; elapsed += 300) {
          await jest.advanceTimersByTimeAsync(300);
          session.emitSpeechStarted();
        }
        expect(tts.synthesizeCalls).toContain("Take your time. I'm still here.");
      } finally {
        jest.useRealTimers();
      }
    });

    /**
     * CHANGED from "resets the timer" to "cancels it", after the first
     * real call on the deployed stack. Re-arming here started the
     * countdown while the CALLER was still talking, so it then ran
     * through Grace's own thinking AND her spoken reply — and fired
     * "Take your time, I'm still here" a second or two after she stopped
     * speaking, repeatedly, which is the exact opposite of a silence
     * check-in's purpose.
     *
     * Cancelling is correct because a real turn follows recognized
     * speech, and the timer is armed again at the END of that turn (see
     * armSilenceCheckIn's call sites), i.e. at the only moment Grace is
     * genuinely waiting on the caller.
     *
     * This does NOT reopen the "caller stuck in an STT dead zone" bug
     * this check-in exists for: that case produces EMPTY transcripts,
     * which deepgram-stt.provider.ts never forwards as interim speech at
     * all, so the timer armed after Grace's previous turn survives
     * untouched and still fires.
     */
    it("real recognized speech CANCELS the pending check-in — a talking caller needs no check-in", async () => {
      jest.useFakeTimers();
      try {
        const { orchestrator, stt, tts } = buildOrchestratorUnderTest();
        const sink = new FakeMediaStreamSink();

        await orchestrator.onCallStart(baseParams(), sink);
        const session = stt.sessions[0]!;

        await jest.advanceTimersByTimeAsync(800);
        session.emitSpeechStarted();
        session.emitInterimSpeech(); // real recognized text, not just VAD energy
        await jest.advanceTimersByTimeAsync(0);

        // Well past the original window, and past a hypothetical fresh
        // one: nothing fires, because the caller is speaking.
        await jest.advanceTimersByTimeAsync(3000);
        expect(tts.synthesizeCalls).not.toContain("Take your time. I'm still here.");
      } finally {
        jest.useRealTimers();
      }
    });

    it("onCallEnd cancels a pending check-in so it never fires after the call has ended", async () => {
      jest.useFakeTimers();
      try {
        const { orchestrator, tts } = buildOrchestratorUnderTest();
        const sink = new FakeMediaStreamSink();

        await orchestrator.onCallStart(baseParams(), sink);
        await orchestrator.onCallEnd(baseParams(), "caller_hangup");

        await jest.advanceTimersByTimeAsync(5000);
        expect(tts.synthesizeCalls).not.toContain("Take your time. I'm still here.");
      } finally {
        jest.useRealTimers();
      }
    });

    it("re-arms normally for a later, genuinely new silence episode after the caller resumes and Grace responds again", async () => {
      jest.useFakeTimers();
      try {
        const { orchestrator, orchestratorClient, stt, tts } = buildOrchestratorUnderTest();
        const sink = new FakeMediaStreamSink();
        orchestratorClient.turnResponses = [
          {
            conversationId: "conv-1",
            responseText: "Got it, what's the issue?",
            toolCallsExecuted: [],
            interrupted: false,
            state: "qualifying",
          },
        ];

        await orchestrator.onCallStart(baseParams(), sink);
        const session = stt.sessions[0]!;
        session.emitFinalTranscript("my sink is leaking", 0.9);
        await jest.advanceTimersByTimeAsync(0);
        expect(tts.synthesizeCalls).toContain("Got it, what's the issue?");

        // A genuinely NEW silence episode after Grace's real response —
        // this is a DIFFERENT episode than any prior one, so it should
        // still get its own check-in, not be permanently suppressed by
        // the earlier one having already fired once.
        await jest.advanceTimersByTimeAsync(1000);
        expect(tts.synthesizeCalls).toContain("Take your time. I'm still here.");
      } finally {
        jest.useRealTimers();
      }
    });

    it("two separate call instances don't share or interfere with each other's silence timers (session isolation)", async () => {
      jest.useFakeTimers();
      try {
        const first = buildOrchestratorUnderTest();
        const second = buildOrchestratorUnderTest();
        const sinkA = new FakeMediaStreamSink();
        const sinkB = new FakeMediaStreamSink();

        await first.orchestrator.onCallStart(baseParams({ callId: "call-a" }), sinkA);
        await jest.advanceTimersByTimeAsync(500);
        await second.orchestrator.onCallStart(baseParams({ callId: "call-b" }), sinkB);

        // Call A's silence timer started 500ms before call B's — at
        // t=1000ms (500ms into B's own window), A should have already
        // checked in and B should not have yet.
        await jest.advanceTimersByTimeAsync(500);
        expect(first.tts.synthesizeCalls).toContain("Take your time. I'm still here.");
        expect(second.tts.synthesizeCalls).not.toContain("Take your time. I'm still here.");

        await jest.advanceTimersByTimeAsync(500);
        expect(second.tts.synthesizeCalls).toContain("Take your time. I'm still here.");
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe("farewell hang-up (the caller says goodbye and the line actually drops)", () => {
    async function runUntilGoodbye(closingLine: string) {
      const harness = buildOrchestratorUnderTest();
      const { orchestrator, orchestratorClient, stt } = harness;
      const sink = new FakeMediaStreamSink();
      const params = baseParams();
      orchestratorClient.turnResponses = [
        {
          conversationId: "conv-1",
          responseText: "Got it, a leaking sink. What's your name?",
          toolCallsExecuted: [],
          interrupted: false,
          state: "qualifying",
        },
        {
          conversationId: "conv-1",
          responseText: closingLine,
          toolCallsExecuted: [],
          interrupted: false,
          state: "closing",
        },
      ];

      await orchestrator.onCallStart(params, sink);
      const session = stt.sessions[0]!;
      session.emitFinalTranscript("my sink is leaking", 0.95);
      await flushMicrotasks();
      session.emitFinalTranscript("okay bye", 0.99);
      await flushMicrotasks();
      return { ...harness, session, params };
    }

    it("hangs up on the caller's goodbye, after the grace period, with its own end reason", async () => {
      process.env["FAREWELL_HANGUP_GRACE_MS"] = "5";
      const { callTransfer, orchestratorClient, tts, params } = await runUntilGoodbye(
        "Bye, have a great day ahead.",
      );
      await new Promise((resolve) => setTimeout(resolve, 30));

      expect(tts.synthesizeCalls).toContain("Bye, have a great day ahead.");
      expect(callTransfer.hangUps).toEqual([params.callSid]);
      expect(orchestratorClient.endCalls).toHaveLength(1);
      expect(orchestratorClient.endCalls[0]?.req.endReason).toBe("agent_hangup_after_farewell");
    });

    it("does NOT hang up while the grace period is still running — the closing line finishes first", async () => {
      process.env["FAREWELL_HANGUP_GRACE_MS"] = "400";
      const { callTransfer } = await runUntilGoodbye("Bye, have a great day ahead.");
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(callTransfer.hangUps).toEqual([]);
    });

    it("abandons the hang-up when the caller speaks again during the grace period", async () => {
      process.env["FAREWELL_HANGUP_GRACE_MS"] = "200";
      const { callTransfer, orchestratorClient, session } = await runUntilGoodbye(
        "Bye, have a great day ahead.",
      );
      orchestratorClient.turnResponses = [
        {
          conversationId: "conv-1",
          responseText: "Of course, what else can I get for you?",
          toolCallsExecuted: [],
          interrupted: false,
          state: "qualifying",
        },
      ];
      session.emitFinalTranscript("wait one more thing", 0.97);
      await flushMicrotasks();
      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(callTransfer.hangUps).toEqual([]);
      expect(orchestratorClient.endCalls).toHaveLength(0);
    });

    it("never hangs up on a closing turn that ends in a question", async () => {
      process.env["FAREWELL_HANGUP_GRACE_MS"] = "5";
      const { callTransfer } = await runUntilGoodbye("Before you go, what's your name?");
      await new Promise((resolve) => setTimeout(resolve, 30));

      expect(callTransfer.hangUps).toEqual([]);
    });
  });
});

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
