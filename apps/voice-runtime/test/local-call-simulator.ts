/**
 * The local call simulator — docs/28 §O's "you do not need real
 * Twilio/LiveKit/Deepgram credentials to test your integration logic"
 * promise, applied to THIS runtime rather than a hypothetical one. Drives
 * the REAL `CallSessionOrchestrator` (this service's own turn-loop/
 * barge-in/capacity/emergency logic) against hand-written fakes for every
 * external I/O boundary this service has: the orchestrator HTTP client,
 * Deepgram STT, ElevenLabs TTS, and the Twilio call-transfer REST call.
 * Nothing here is a stand-in for voice-orchestrator's OWN contract tests
 * (apps/voice-orchestrator/test/runtime-contract.e2e.spec.ts already
 * covers that, real module graph, real HTTP) — this harness exists to
 * prove voice-runtime's OWN translation/retry/barge-in/capacity logic
 * behaves correctly, independent of whether a real phone network, Deepgram
 * account, or ElevenLabs account is reachable from this environment.
 *
 * Run standalone: `pnpm --filter @ethixweb/voice-runtime run simulate`
 * Run as Jest specs (asserted, CI-friendly): `pnpm --filter
 * @ethixweb/voice-runtime run test:e2e` (test/call-scenarios.e2e.spec.ts
 * imports the SAME `runScenario` helper below).
 */
import { CallSessionOrchestrator } from "../src/modules/call-session/application/call-session-orchestrator";
import type { CallSessionParams } from "../src/modules/call-session/domain/call-session";
import { createNoopLogger } from "../src/modules/call-session/application/__fakes__/fake-logger";
import { FakeMediaStreamSink } from "../src/modules/call-session/application/__fakes__/fake-media-stream-sink";
import { FakeCallTransferProvider } from "../src/modules/telephony/infrastructure/__fakes__/fake-call-transfer.provider";
import { FakeOrchestratorClient } from "../src/modules/orchestrator-client/infrastructure/__fakes__/fake-orchestrator-client";
import { FakeSpeechToTextProvider } from "../src/modules/speech/infrastructure/__fakes__/fake-speech-to-text.provider";
import { FakeTextToSpeechProvider } from "../src/modules/speech/infrastructure/__fakes__/fake-text-to-speech.provider";

export function buildSimulatedCall(): {
  orchestrator: CallSessionOrchestrator;
  orchestratorClient: FakeOrchestratorClient;
  stt: FakeSpeechToTextProvider;
  tts: FakeTextToSpeechProvider;
  callTransfer: FakeCallTransferProvider;
  sink: FakeMediaStreamSink;
  params: CallSessionParams;
} {
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
  const sink = new FakeMediaStreamSink();
  const params: CallSessionParams = {
    callId: "sim-call-1",
    tenantId: "sim-tenant-1",
    businessId: "sim-business-1",
    callerAni: "+15551234567",
    callSid: "CAsimulated",
    streamSid: "MZsimulated",
  };
  return { orchestrator, orchestratorClient, stt, tts, callTransfer, sink, params };
}

/** Standalone CLI entry point — prints a plain-English pass/fail summary for each scenario, for a human running `pnpm run simulate` locally without Jest. */
async function main(): Promise<void> {
  const scenarios: Array<{ name: string; run: () => Promise<void> }> = [
    {
      name: "normal conversation",
      run: async () => {
        const { orchestrator, orchestratorClient, stt, tts, sink, params } = buildSimulatedCall();
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
        stt.sessions[0]?.emitFinalTranscript("my sink is leaking", 0.9);
        await delay(20);
        assert(orchestratorClient.turnCalls.length === 1, "expected exactly one turn call");
        assert(
          tts.synthesizeCalls.includes("Got it, what's the issue?"),
          "expected TTS to speak the response",
        );
      },
    },
    {
      name: "caller disconnect",
      run: async () => {
        const { orchestrator, orchestratorClient, sink, params } = buildSimulatedCall();
        await orchestrator.onCallStart(params, sink);
        await orchestrator.onCallEnd(params, "caller_hangup");
        assert(orchestratorClient.endCalls.length === 1, "expected end-conversation to be called");
      },
    },
  ];

  let failures = 0;
  for (const scenario of scenarios) {
    try {
      await scenario.run();
      // eslint-disable-next-line no-console -- CLI output is this script's entire purpose
      console.log(`PASS  ${scenario.name}`);
    } catch (error) {
      failures += 1;
      // eslint-disable-next-line no-console
      console.error(
        `FAIL  ${scenario.name}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // eslint-disable-next-line no-console
  console.log(`\n${scenarios.length - failures}/${scenarios.length} scenarios passed.`);
  // Full assertion coverage (interruption, duplicate turn, timeouts,
  // capacity, emergency, provider failures) lives in
  // call-scenarios.e2e.spec.ts, run via `pnpm run test:e2e` — this CLI
  // entry point is a quick human-readable smoke check, not the full suite.
  if (failures > 0) {
    process.exitCode = 1;
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

if (require.main === module) {
  main().catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error("Simulator crashed:", error);
    process.exitCode = 1;
  });
}
