import type { StructuredLogger } from "@ethixweb/shared-kernel";
import { CallSession, type ChatContextLike } from "./call-session.js";
import type { OrchestratorClient, SendTurnInput, TurnResult } from "./orchestrator-client.js";
import type { RuntimeConfig } from "./config.js";

function noopLogger(): StructuredLogger {
  const logger: StructuredLogger = {
    child: () => logger,
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
  return logger;
}

function baseConfig(): RuntimeConfig {
  return {
    port: 3200,
    orchestratorBaseUrl: "http://localhost:3100/v1",
    orchestratorServiceToken: "token",
    deepgramApiKey: "dg",
    deepgramModel: "nova-3",
    cartesiaApiKey: "ct",
    cartesiaModel: "sonic-3",
    cartesiaVoice: "voice-1",
    pilotTenantId: "tenant-1",
    pilotBusinessId: "business-1",
    pilotTimezone: "America/Chicago",
    pilotAllowedTools: ["searchCustomer", "createLead", "escalateEmergency"],
  };
}

function userTurnChatCtx(text: string, confidence?: number): ChatContextLike {
  return {
    items: [
      {
        type: "message",
        role: "user",
        textContent: text,
        transcriptConfidence: confidence,
      },
    ],
  };
}

function defaultTurnResult(): TurnResult {
  return {
    conversationId: "conv-1",
    responseText: "ok",
    toolCallsExecuted: [],
    interrupted: false,
    state: "qualifying",
    transferTargets: null,
  };
}

// Mocks are kept as plain, un-cast `jest.Mock` references and asserted on
// directly — accessing them back off the `OrchestratorClient`-typed object
// instead would trip @typescript-eslint/unbound-method, same reasoning as
// domain-exception.filter.spec.ts's own comment on this exact pattern.
function buildFakeOrchestrator(): {
  orchestrator: OrchestratorClient;
  startConversationMock: jest.Mock;
  sendTurnMock: jest.Mock;
  interruptMock: jest.Mock;
  endConversationMock: jest.Mock;
} {
  const startConversationMock = jest.fn().mockResolvedValue({ id: "conv-1" });
  const sendTurnMock = jest.fn().mockResolvedValue(defaultTurnResult());
  const interruptMock = jest.fn().mockResolvedValue({ id: "conv-1" });
  const endConversationMock = jest.fn().mockResolvedValue({ id: "conv-1" });
  const orchestrator = {
    startConversation: startConversationMock,
    sendTurn: sendTurnMock,
    interrupt: interruptMock,
    endConversation: endConversationMock,
    findByCallId: jest.fn().mockResolvedValue(null),
  } as unknown as OrchestratorClient;
  return { orchestrator, startConversationMock, sendTurnMock, interruptMock, endConversationMock };
}

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const value of gen) {
    out.push(value);
  }
  return out;
}

describe("CallSession", () => {
  it("starts a conversation with a freshly generated callId and the pilot's static tenant config", async () => {
    const { orchestrator, startConversationMock } = buildFakeOrchestrator();
    const session = new CallSession({
      orchestrator,
      config: baseConfig(),
      transferExecutor: jest.fn(),
      logger: noopLogger(),
    });

    await session.start("+15551234567", "+15559876543");

    expect(startConversationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        businessId: "business-1",
        callerAni: "+15551234567",
        toNumber: "+15559876543",
        timezone: "America/Chicago",
      }),
    );
    const sentInput = startConversationMock.mock.calls[0][0] as { callId: string };
    expect(sentInput.callId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("createLlmNode sends the last user transcript and yields the orchestrator's responseText", async () => {
    const { orchestrator, sendTurnMock } = buildFakeOrchestrator();
    sendTurnMock.mockResolvedValue({
      ...defaultTurnResult(),
      responseText: "Thanks, how can I help?",
    });
    const session = new CallSession({
      orchestrator,
      config: baseConfig(),
      transferExecutor: jest.fn(),
      logger: noopLogger(),
    });
    await session.start("+15551234567");

    const llmNode = session.createLlmNode();
    const generator = await llmNode(
      undefined,
      userTurnChatCtx("my sink is leaking"),
      undefined,
      undefined,
    );
    const chunks = await collect(generator);

    expect(chunks).toEqual(["Thanks, how can I help?"]);
    const sentInput = sendTurnMock.mock.calls[0][1] as SendTurnInput;
    expect(sentInput.transcript).toBe("my sink is leaking");
    expect(sentInput.allowedTools).toEqual(["searchCustomer", "createLead", "escalateEmergency"]);
    expect(typeof sentInput.idempotencyKey).toBe("string");
    expect(sentInput.idempotencyKey.length).toBeGreaterThan(0);
  });

  it("generates a fresh idempotencyKey per distinct turn", async () => {
    const { orchestrator, sendTurnMock } = buildFakeOrchestrator();
    const session = new CallSession({
      orchestrator,
      config: baseConfig(),
      transferExecutor: jest.fn(),
      logger: noopLogger(),
    });
    await session.start("+15551234567");
    const llmNode = session.createLlmNode();

    await collect(await llmNode(undefined, userTurnChatCtx("first"), undefined, undefined));
    await collect(await llmNode(undefined, userTurnChatCtx("second"), undefined, undefined));

    const keys = sendTurnMock.mock.calls.map(
      (call) => (call[1] as SendTurnInput).idempotencyKey,
    );
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("fires the transfer executor with transferTargets, AFTER yielding the response text", async () => {
    const events: string[] = [];
    const { orchestrator, sendTurnMock } = buildFakeOrchestrator();
    sendTurnMock.mockResolvedValue({
      ...defaultTurnResult(),
      responseText: "Connecting you now.",
      toolCallsExecuted: ["escalateEmergency"],
      state: "escalating",
      transferTargets: ["+15550001111"],
    });
    const transferExecutor = jest.fn().mockImplementation(async () => {
      events.push("transfer");
    });
    const session = new CallSession({
      orchestrator,
      config: baseConfig(),
      transferExecutor,
      logger: noopLogger(),
    });
    await session.start("+15551234567");

    const generator = await session.createLlmNode()(
      undefined,
      userTurnChatCtx("there's a gas leak"),
      undefined,
      undefined,
    );
    for await (const chunk of generator) {
      events.push(`yield:${chunk}`);
    }

    expect(events).toEqual(["yield:Connecting you now.", "transfer"]);
    expect(transferExecutor).toHaveBeenCalledWith(["+15550001111"]);
  });

  it("does not crash the turn when the transfer executor itself fails", async () => {
    const { orchestrator, sendTurnMock } = buildFakeOrchestrator();
    sendTurnMock.mockResolvedValue({
      ...defaultTurnResult(),
      responseText: "Connecting you now.",
      toolCallsExecuted: ["escalateEmergency"],
      state: "escalating",
      transferTargets: ["+15550001111"],
    });
    const transferExecutor = jest.fn().mockRejectedValue(new Error("SIP trunk unreachable"));
    const session = new CallSession({
      orchestrator,
      config: baseConfig(),
      transferExecutor,
      logger: noopLogger(),
    });
    await session.start("+15551234567");

    const generator = await session.createLlmNode()(
      undefined,
      userTurnChatCtx("there's a gas leak"),
      undefined,
      undefined,
    );

    await expect(collect(generator)).resolves.toEqual(["Connecting you now."]);
  });

  describe("handleBargeIn — docs/24 §2.3's two mechanisms", () => {
    it("aborts the in-flight turn (mechanism 1) rather than calling /interrupt when a turn is mid-flight", async () => {
      const { orchestrator, sendTurnMock, interruptMock } = buildFakeOrchestrator();
      sendTurnMock.mockImplementation(
        (_id: string, _input: SendTurnInput, signal?: AbortSignal) =>
          new Promise((_resolve, reject) => {
            signal?.addEventListener("abort", () => {
              const err = new Error("aborted");
              err.name = "AbortError";
              reject(err);
            });
          }),
      );
      const session = new CallSession({
        orchestrator,
        config: baseConfig(),
        transferExecutor: jest.fn(),
        logger: noopLogger(),
      });
      await session.start("+15551234567");

      const generator = await session.createLlmNode()(
        undefined,
        userTurnChatCtx("wait, actually"),
        undefined,
        undefined,
      );
      const consumePromise = collect(generator);

      // Give the turn a tick to register as in-flight before interrupting.
      await new Promise((resolve) => setImmediate(resolve));
      session.handleBargeIn();

      await expect(consumePromise).resolves.toEqual([]);
      expect(interruptMock).not.toHaveBeenCalled();
    });

    it("calls /interrupt (mechanism 2) when no turn is in flight", async () => {
      const { orchestrator, interruptMock } = buildFakeOrchestrator();
      const session = new CallSession({
        orchestrator,
        config: baseConfig(),
        transferExecutor: jest.fn(),
        logger: noopLogger(),
      });
      await session.start("+15551234567");

      session.handleBargeIn();
      await new Promise((resolve) => setImmediate(resolve));

      expect(interruptMock).toHaveBeenCalledWith("conv-1", "tenant-1");
    });

    it("is a no-op before the conversation has started", () => {
      const { orchestrator, interruptMock } = buildFakeOrchestrator();
      const session = new CallSession({
        orchestrator,
        config: baseConfig(),
        transferExecutor: jest.fn(),
        logger: noopLogger(),
      });

      expect(() => session.handleBargeIn()).not.toThrow();
      expect(interruptMock).not.toHaveBeenCalled();
    });
  });

  describe("end", () => {
    it("ends the conversation with the given reason", async () => {
      const { orchestrator, endConversationMock } = buildFakeOrchestrator();
      const session = new CallSession({
        orchestrator,
        config: baseConfig(),
        transferExecutor: jest.fn(),
        logger: noopLogger(),
      });
      await session.start("+15551234567");

      await session.end("caller_hangup");

      expect(endConversationMock).toHaveBeenCalledWith("conv-1", "tenant-1", "caller_hangup");
    });

    it("is a no-op before the conversation has started", async () => {
      const { orchestrator, endConversationMock } = buildFakeOrchestrator();
      const session = new CallSession({
        orchestrator,
        config: baseConfig(),
        transferExecutor: jest.fn(),
        logger: noopLogger(),
      });

      await expect(session.end("caller_hangup")).resolves.toBeUndefined();
      expect(endConversationMock).not.toHaveBeenCalled();
    });
  });
});
