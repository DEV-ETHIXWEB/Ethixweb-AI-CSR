import { Test } from "@nestjs/testing";
import { ModuleRef } from "@nestjs/core";
import { Module } from "@nestjs/common";
import { APP_LOGGER } from "../../../shared/observability/app-logger.module";
import {
  CALL_TRANSFER_PROVIDER,
  type CallTransferProvider,
} from "../../telephony/domain/call-transfer.port";
import { ORCHESTRATOR_CLIENT } from "../../orchestrator-client/domain/orchestrator-client.port";
import { SPEECH_TO_TEXT_PROVIDER } from "../../speech/domain/speech-to-text.port";
import { TEXT_TO_SPEECH_PROVIDER } from "../../speech/domain/text-to-speech.port";
import { FakeOrchestratorClient } from "../../orchestrator-client/infrastructure/__fakes__/fake-orchestrator-client";
import { FakeSpeechToTextProvider } from "../../speech/infrastructure/__fakes__/fake-speech-to-text.provider";
import { FakeTextToSpeechProvider } from "../../speech/infrastructure/__fakes__/fake-text-to-speech.provider";
import { FakeCallTransferProvider } from "../../telephony/infrastructure/__fakes__/fake-call-transfer.provider";
import { createNoopLogger } from "./__fakes__/fake-logger";
import { FakeMediaStreamSink } from "./__fakes__/fake-media-stream-sink";
import { CallSessionOrchestrator } from "./call-session-orchestrator";
import type { CallSessionParams } from "../domain/call-session";

function baseParams(callId: string): CallSessionParams {
  return {
    tenantId: "tenant-1",
    businessId: "business-1",
    callId,
    callerAni: "+15551234567",
    callSid: "CA123",
    streamSid: "MZ123",
  };
}

@Module({
  providers: [
    CallSessionOrchestrator,
    { provide: ORCHESTRATOR_CLIENT, useFactory: () => new FakeOrchestratorClient() },
    { provide: SPEECH_TO_TEXT_PROVIDER, useFactory: () => new FakeSpeechToTextProvider() },
    { provide: TEXT_TO_SPEECH_PROVIDER, useFactory: () => new FakeTextToSpeechProvider() },
    {
      provide: CALL_TRANSFER_PROVIDER,
      useFactory: (): CallTransferProvider => new FakeCallTransferProvider(),
    },
    { provide: APP_LOGGER, useFactory: () => createNoopLogger() },
  ],
})
class TestCallSessionModule {}

/**
 * FOUND LIVE: the single most severe bug this investigation turned up.
 * media-stream.gateway.ts calls `moduleRef.resolve(CallSessionOrchestrator,
 * undefined, { strict: false })` once per WebSocket connection specifically
 * to get a fresh, call-scoped instance — but `CallSessionOrchestrator` was
 * only ever `@Injectable()` with no explicit scope, which defaults to
 * Nest's DEFAULT (singleton) scope. For a DEFAULT-scoped provider,
 * `moduleRef.resolve()` does NOT create a new instance — it returns the
 * SAME shared singleton every time, identically to `.get()`. Real
 * consequence, reproduced from a live call's own logs: call N's caller
 * hangs up, setting `this.ended = true` on the (shared) instance; call
 * N+1 on the SAME still-running process reused that exact instance —
 * greeting played, STT transcribed correctly — but every finalized
 * transcript silently no-opped on `handleFinalTranscript`'s own
 * `if (!this.conversationId || this.ended) return` guard, with zero logs
 * either way. Every call after the first one handled by a given running
 * process was broken this way until the process restarted.
 *
 * This test exercises the REAL Nest DI container (not a plain `new
 * CallSessionOrchestrator(...)`, which bypasses scope entirely and could
 * never have caught this) the exact way production code does:
 * `moduleRef.resolve()` twice, simulating two sequential calls on one
 * running process.
 */
describe("CallSessionOrchestrator DI scope", () => {
  const originalSilenceTimeout = process.env["SILENCE_CHECK_IN_TIMEOUT_MS"];
  beforeEach(() => {
    // Every test here drives onCallStart (real or concurrent), which now
    // arms a real silence-check-in timer after the greeting — none of
    // these call onCallEnd, so left at the real 10s default that timer
    // kept the process alive well past the test run finishing (same
    // issue found and fixed in call-session-orchestrator.spec.ts).
    process.env["SILENCE_CHECK_IN_TIMEOUT_MS"] = "5";
  });
  afterEach(() => {
    if (originalSilenceTimeout === undefined) {
      delete process.env["SILENCE_CHECK_IN_TIMEOUT_MS"];
    } else {
      process.env["SILENCE_CHECK_IN_TIMEOUT_MS"] = originalSilenceTimeout;
    }
  });

  it("moduleRef.resolve() returns a genuinely fresh instance per call, not the same shared singleton", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [TestCallSessionModule],
    }).compile();
    const nestModuleRef = moduleRef.get(ModuleRef);

    const first = await nestModuleRef.resolve(CallSessionOrchestrator, undefined, {
      strict: false,
    });
    const second = await nestModuleRef.resolve(CallSessionOrchestrator, undefined, {
      strict: false,
    });

    expect(first).not.toBe(second);
  });

  it("a call ending on one instance does not leave the NEXT call's instance silently broken (the exact live failure)", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [TestCallSessionModule],
    }).compile();
    const nestModuleRef = moduleRef.get(ModuleRef);

    // Call 1: starts and ends normally (caller hangs up).
    const firstCallOrchestrator = await nestModuleRef.resolve(CallSessionOrchestrator, undefined, {
      strict: false,
    });
    const firstSink = new FakeMediaStreamSink();
    await firstCallOrchestrator.onCallStart(baseParams("call-1"), firstSink);
    await firstCallOrchestrator.onCallEnd(baseParams("call-1"), "caller_hangup");

    // Call 2: a NEW connection, resolved fresh, exactly as
    // media-stream.gateway.ts does per WebSocket connection.
    const secondCallOrchestrator = await nestModuleRef.resolve(CallSessionOrchestrator, undefined, {
      strict: false,
    });
    const secondSink = new FakeMediaStreamSink();
    await secondCallOrchestrator.onCallStart(baseParams("call-2"), secondSink);

    const secondStt: FakeSpeechToTextProvider = await nestModuleRef.resolve(
      SPEECH_TO_TEXT_PROVIDER,
      undefined,
      { strict: false },
    );
    // Both calls share the SAME fake STT provider instance (module-scoped,
    // not call-scoped, matching the real SpeechModule's own singleton
    // Deepgram provider) — call 2's own session is the most recent one.
    const call2Session = secondStt.sessions.at(-1)!;
    call2Session.emitFinalTranscript("hello, is anyone there", 0.95);
    await new Promise((resolve) => setTimeout(resolve, 10));

    const secondOrchestratorClient: FakeOrchestratorClient = await nestModuleRef.resolve(
      ORCHESTRATOR_CLIENT,
      undefined,
      { strict: false },
    );
    expect(secondOrchestratorClient.turnCalls).toHaveLength(1);
    expect(secondOrchestratorClient.turnCalls[0]?.req.transcript).toBe("hello, is anyone there");
  });

  /**
   * QA mission Phase 3 (multi-call/session isolation): the two tests above
   * prove SEQUENTIAL reuse is safe (call 2 starts only after call 1 fully
   * ends). This test goes further and proves CONCURRENT isolation — five
   * calls genuinely overlapping in time, each started before any of the
   * others finish, each fed its own distinct transcripts interleaved with
   * the others' — and confirms every single turn landed on the correct
   * call's own conversationId, with zero cross-talk. This is the shape a
   * real multi-line deployment actually produces (simultaneous inbound
   * calls on a running process), not just "one call after another."
   */
  it("five concurrent, interleaved calls never cross-contaminate each other's turns", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [TestCallSessionModule],
    }).compile();
    const nestModuleRef = moduleRef.get(ModuleRef);
    const sharedOrchestratorClient: FakeOrchestratorClient = await nestModuleRef.resolve(
      ORCHESTRATOR_CLIENT,
      undefined,
      { strict: false },
    );
    const sharedStt: FakeSpeechToTextProvider = await nestModuleRef.resolve(
      SPEECH_TO_TEXT_PROVIDER,
      undefined,
      { strict: false },
    );

    const callIds = ["call-A", "call-B", "call-C", "call-D", "call-E"];
    // Each call gets its own orchestrator instance AND its own
    // conversationId, resolved/started concurrently via Promise.all —
    // genuinely overlapping, not sequential.
    const orchestrators = await Promise.all(
      callIds.map(() =>
        nestModuleRef.resolve(CallSessionOrchestrator, undefined, { strict: false }),
      ),
    );
    await Promise.all(
      orchestrators.map((orchestrator, index) =>
        orchestrator.onCallStart(baseParams(callIds[index]!), new FakeMediaStreamSink()),
      ),
    );

    // Interleave: emit call A's, then B's, then C's, etc. transcripts in a
    // round-robin, not call-by-call — the exact "genuinely overlapping"
    // shape a real concurrent-calls scenario produces.
    for (let i = 0; i < callIds.length; i++) {
      sharedStt.sessions[i]!.emitFinalTranscript(`transcript from ${callIds[i]}`, 0.9);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(sharedOrchestratorClient.turnCalls).toHaveLength(5);
    // Every call's OWN turn carries ITS OWN transcript AND landed on ITS
    // OWN conversationId — cross-contamination would show up as either a
    // transcript attributed to the wrong conversationId, a missing turn,
    // or a duplicate.
    const seenConversationIds = new Set<string>();
    for (let i = 0; i < callIds.length; i++) {
      const expectedTranscript = `transcript from ${callIds[i]}`;
      const matching = sharedOrchestratorClient.turnCalls.filter(
        (call) => call.req.transcript === expectedTranscript,
      );
      expect(matching).toHaveLength(1);
      const conversationId = matching[0]!.conversationId;
      // Each call's conversationId is genuinely distinct from every other
      // call's — proves onCallStart's own StartConversationRequest for
      // call i never got confused with call j's.
      expect(seenConversationIds.has(conversationId)).toBe(false);
      seenConversationIds.add(conversationId);
    }
    expect(seenConversationIds.size).toBe(5);
  });
});
