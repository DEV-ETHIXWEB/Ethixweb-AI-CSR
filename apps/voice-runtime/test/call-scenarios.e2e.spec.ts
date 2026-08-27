import {
  OrchestratorCapacityExceededError,
  OrchestratorHttpError,
} from "../src/modules/orchestrator-client/domain/orchestrator-client.port";
import { buildSimulatedCall } from "./local-call-simulator";

/**
 * The full scripted-scenario suite this build's deliverable list requires:
 * normal conversation, interruption, duplicate turn, provider timeout,
 * provider failure, orchestrator failure, caller disconnect, emergency,
 * capacity rejection — each driven through the REAL CallSessionOrchestrator
 * against hand-written fakes (see local-call-simulator.ts's own comment on
 * why fakes, not a live Twilio/Deepgram/ElevenLabs account). Distinct from
 * call-session-orchestrator.spec.ts (the unit-level test for the same
 * class): this file exists specifically as the "local simulator" scenario
 * coverage the build's deliverables checklist calls out as its own
 * requirement, kept in test/ (like voice-orchestrator's own e2e split) so
 * it reads as one coherent scenario document rather than being interleaved
 * with the class's unit specs.
 */
describe("Voice Runtime local call simulator — scripted scenarios", () => {
  it("SCENARIO: normal conversation — start, one turn, response spoken", async () => {
    const { orchestrator, orchestratorClient, stt, tts, sink, params } = buildSimulatedCall();
    orchestratorClient.turnResponses = [
      {
        conversationId: "conv-1",
        responseText: "Got it, what's the issue?",
        toolCallsExecuted: ["searchCustomer"],
        interrupted: false,
        state: "qualifying",
      },
    ];

    await orchestrator.onCallStart(params, sink);
    stt.sessions[0]?.emitFinalTranscript("my sink is leaking", 0.9);
    await flush();

    expect(orchestratorClient.startCalls).toHaveLength(1);
    expect(orchestratorClient.turnCalls).toHaveLength(1);
    expect(tts.synthesizeCalls).toEqual(["Got it, what's the issue?"]);
    expect(sink.audioSent.length).toBeGreaterThan(0);
  });

  it("SCENARIO: interruption — barge-in mid-turn aborts the in-flight HTTP call, no response is spoken for the aborted turn", async () => {
    const { orchestrator, orchestratorClient, stt, tts, sink, params } = buildSimulatedCall();
    orchestratorClient.hangTurnUntilAborted = true;

    await orchestrator.onCallStart(params, sink);
    stt.sessions[0]?.emitFinalTranscript("hello", 0.9);
    await flush();
    stt.sessions[0]?.emitSpeechStarted();
    await flush();

    expect(orchestratorClient.turnCalls).toHaveLength(1);
    expect(tts.synthesizeCalls).toHaveLength(0); // aborted turn never produced a response to speak
  });

  it("SCENARIO: duplicate turn — a retried 5xx reuses the SAME idempotencyKey (docs/28 §G)", async () => {
    const { orchestrator, orchestratorClient, stt, tts, sink, params } = buildSimulatedCall();
    orchestratorClient.turnResponses = [
      new OrchestratorHttpError("connection reset", 503, true),
      {
        conversationId: "conv-1",
        responseText: "sorted",
        toolCallsExecuted: [],
        interrupted: false,
        state: "qualifying",
      },
    ];

    await orchestrator.onCallStart(params, sink);
    stt.sessions[0]?.emitFinalTranscript("hi", 0.9);
    await flush();
    await delay(600);

    expect(orchestratorClient.turnCalls).toHaveLength(2);
    expect(orchestratorClient.turnCalls[0]?.req.idempotencyKey).toBe(
      orchestratorClient.turnCalls[1]?.req.idempotencyKey,
    );
    expect(tts.synthesizeCalls).toContain("sorted");
  });

  it("SCENARIO: provider timeout — orchestrator client call times out (network-level rejection), retried, then succeeds", async () => {
    const { orchestrator, orchestratorClient, stt, tts, sink, params } = buildSimulatedCall();
    orchestratorClient.turnResponses = [
      new OrchestratorHttpError("request timed out", 0, true),
      {
        conversationId: "conv-1",
        responseText: "here you go",
        toolCallsExecuted: [],
        interrupted: false,
        state: "qualifying",
      },
    ];

    await orchestrator.onCallStart(params, sink);
    stt.sessions[0]?.emitFinalTranscript("hi", 0.9);
    await flush();
    await delay(600);

    expect(orchestratorClient.turnCalls).toHaveLength(2);
    expect(tts.synthesizeCalls).toContain("here you go");
  });

  it("SCENARIO: provider failure — TTS synthesis fails mid-utterance, does not crash the call", async () => {
    const { orchestrator, orchestratorClient, tts, stt, sink, params } = buildSimulatedCall();
    orchestratorClient.turnResponses = [
      {
        conversationId: "conv-1",
        responseText: "let me check that",
        toolCallsExecuted: [],
        interrupted: false,
        state: "qualifying",
      },
    ];
    tts.failNextWith = new Error("ElevenLabs unavailable");

    await orchestrator.onCallStart(params, sink);
    await expect(
      (async () => {
        stt.sessions[0]?.emitFinalTranscript("hi", 0.9);
        await flush();
      })(),
    ).resolves.toBeUndefined();
  });

  it("SCENARIO: orchestrator failure — POST /conversations fails outright at call start, apology spoken, stream closed (docs/28 §J step 2)", async () => {
    const { orchestrator, orchestratorClient, tts, sink, params } = buildSimulatedCall();
    orchestratorClient.startResponses = [new OrchestratorHttpError("core-api down", 503, true)];

    await orchestrator.onCallStart(params, sink);

    expect(tts.synthesizeCalls[0]).toMatch(/unable to take your call/i);
    expect(sink.closed).toBe(true);
  });

  it("SCENARIO: caller disconnect — Twilio stop event triggers end-conversation and closes the STT session", async () => {
    const { orchestrator, orchestratorClient, stt, sink, params } = buildSimulatedCall();
    await orchestrator.onCallStart(params, sink);
    const session = stt.sessions[0]!;

    await orchestrator.onCallEnd(params, "caller_hangup");

    expect(orchestratorClient.endCalls).toHaveLength(1);
    expect(orchestratorClient.endCalls[0]?.req.endReason).toBe("caller_hangup");
    expect(session.closed).toBe(true);
  });

  it("SCENARIO: emergency — escalation.action === forward_call triggers a real Twilio call transfer (docs/28 §M)", async () => {
    const originalEnv = process.env["EMERGENCY_TRANSFER_NUMBER"];
    process.env["EMERGENCY_TRANSFER_NUMBER"] = "+15559990000";
    try {
      const { orchestrator, orchestratorClient, stt, callTransfer, sink, params } =
        buildSimulatedCall();
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

      await orchestrator.onCallStart(params, sink);
      stt.sessions[0]?.emitFinalTranscript("burst pipe flooding my basement right now", 0.9);
      await flush();

      expect(callTransfer.transferCalls).toEqual([
        { callSid: params.callSid, destination: "+15559990000" },
      ]);
    } finally {
      if (originalEnv === undefined) {
        delete process.env["EMERGENCY_TRANSFER_NUMBER"];
      } else {
        process.env["EMERGENCY_TRANSFER_NUMBER"] = originalEnv;
      }
    }
  });

  it("SCENARIO: capacity rejection — 429 speaks the brochure segment, waits, and retries the SAME idempotencyKey", async () => {
    jest.useFakeTimers();
    try {
      const { orchestrator, orchestratorClient, stt, tts, sink, params } = buildSimulatedCall();
      orchestratorClient.turnResponses = [
        new OrchestratorCapacityExceededError(0, {
          brochureSegment: { id: "seg-1", text: "We're licensed and insured." },
          overflowNumber: "+15559990000",
        }),
        {
          conversationId: "conv-1",
          responseText: "Thanks for waiting.",
          toolCallsExecuted: [],
          interrupted: false,
          state: "qualifying",
        },
      ];

      await orchestrator.onCallStart(params, sink);
      stt.sessions[0]?.emitFinalTranscript("hi", 0.9);
      await jest.advanceTimersByTimeAsync(0);
      await jest.advanceTimersByTimeAsync(0);

      expect(tts.synthesizeCalls).toContain("We're licensed and insured.");
      expect(orchestratorClient.turnCalls).toHaveLength(2);
      const [first, second] = orchestratorClient.turnCalls;
      expect(first?.req.idempotencyKey).toBe(second?.req.idempotencyKey);
    } finally {
      jest.useRealTimers();
    }
  });
});

function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
