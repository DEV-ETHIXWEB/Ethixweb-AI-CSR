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
});
