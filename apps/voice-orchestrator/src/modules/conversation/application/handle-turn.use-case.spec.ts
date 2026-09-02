import type { AiCompletionChunk } from "../../ai-provider/domain/ai-provider.port";
import { ExecuteToolUseCase } from "../../tool-broker/application/execute-tool.use-case";
import { FakeIdempotencyStore } from "../../tool-broker/application/__fakes__/fake-idempotency-store";
import { FakeToolAuditLog } from "../../tool-broker/application/__fakes__/fake-tool-audit-log";
import { createNoopLogger as createNoopToolLogger } from "../../tool-broker/application/__fakes__/fake-logger";
import { ToolRegistry } from "../../tool-broker/application/tool-registry";
import type { ToolDefinition } from "../../tool-broker/domain/tool-definition";
import type { Conversation } from "../domain/conversation.entity";
import {
  ConversationAlreadyEndedError,
  ConversationNotFoundError,
  TurnAlreadyInFlightError,
} from "../domain/errors";
import { FakeAiProvider } from "./__fakes__/fake-ai-provider";
import { FakeConversationRepository } from "./__fakes__/fake-conversation-repository";
import { FakeEventBus } from "./__fakes__/fake-event-bus";
import { createNoopLogger } from "./__fakes__/fake-logger";
import { HandleTurnUseCase, type HandleTurnCommand } from "./handle-turn.use-case";

function fakeToolDefinition(name: string): ToolDefinition {
  return {
    name,
    version: "v1",
    description: `test tool ${name}`,
    inputSchema: { safeParse: (value: unknown) => ({ success: true, data: value }) } as any,
    jsonSchema: { type: "object" },
    timeoutMs: 1000,
    retryPolicy: { maxAttempts: 1 },
  };
}

function baseConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: "conv-1",
    tenantId: "tenant-1",
    businessId: "business-1",
    callId: "call-1",
    state: "greeting",
    systemPrompt: "You are a CSR.",
    llmModel: "gpt-4o",
    messages: [],
    transcript: [],
    leadId: null,
    startedAt: new Date().toISOString(),
    endedAt: null,
    capacityReservationId: "reservation-1",
    endReason: null,
    version: 1,
    ...overrides,
  };
}

function buildUseCase(options?: {
  aiProvider?: FakeAiProvider;
  repository?: FakeConversationRepository;
  eventBus?: FakeEventBus;
  idempotencyStore?: FakeIdempotencyStore;
  registeredTools?: Array<{
    name: string;
    handler: { execute: (input: unknown, ctx: unknown) => Promise<unknown> };
  }>;
}) {
  const repository = options?.repository ?? new FakeConversationRepository();
  const aiProvider = options?.aiProvider ?? new FakeAiProvider();
  const eventBus = options?.eventBus ?? new FakeEventBus();
  // Same instance handed to both use cases — mirrors production, where
  // both resolve the identical IDEMPOTENCY_STORE singleton via Nest DI.
  const idempotencyStore = options?.idempotencyStore ?? new FakeIdempotencyStore();
  const toolRegistry = new ToolRegistry();
  for (const tool of options?.registeredTools ?? []) {
    toolRegistry.register(fakeToolDefinition(tool.name), tool.handler);
  }
  const executeTool = new ExecuteToolUseCase(
    toolRegistry,
    idempotencyStore,
    new FakeToolAuditLog(),
    createNoopToolLogger(),
  );
  const useCase = new HandleTurnUseCase(
    repository,
    aiProvider,
    executeTool,
    toolRegistry,
    eventBus,
    idempotencyStore,
    createNoopLogger(),
  );
  return { useCase, repository, aiProvider, eventBus, toolRegistry, idempotencyStore };
}

function baseCommand(overrides: Partial<HandleTurnCommand> = {}): HandleTurnCommand {
  return {
    tenantId: "tenant-1",
    conversationId: "conv-1",
    idempotencyKey: "turn-key-1",
    transcript: "hi",
    allowedTools: [],
    ...overrides,
  };
}

describe("HandleTurnUseCase", () => {
  it("appends the caller's transcript, streams the model's reply, and appends that too", async () => {
    const repository = new FakeConversationRepository();
    repository.seed(baseConversation());
    const { useCase } = buildUseCase({ repository });

    const result = await useCase.execute(
      baseCommand({ transcript: "Hi, my water heater is broken" }),
    );

    expect(result.responseText).toBe("hi");
    expect(result.interrupted).toBe(false);
    const saved = await repository.findById("tenant-1", "conv-1");
    expect(saved?.transcript.map((t) => t.speaker)).toEqual(["caller", "agent"]);
    expect(saved?.transcript[0]?.text).toBe("Hi, my water heater is broken");
  });

  /**
   * Regression coverage for a real gap found live: docs/03 §5 already
   * claims STT confidence is "available to the LLM as part of the
   * transcript metadata" — it wasn't. `sttConfidence` was captured on the
   * durable transcript record and then simply discarded; the model never
   * saw it, so the platform prompt's own conditional spelling rule had no
   * signal to act on. This proves the model-visible message now carries a
   * low-confidence flag, while the durable transcript record (asserted
   * above) stays the exact raw text — the flag never pollutes the actual
   * call record, only what the model reads.
   */
  describe("STT confidence signal (docs/03 §5)", () => {
    it("flags a low-confidence transcript to the model, without touching the durable transcript record", async () => {
      const repository = new FakeConversationRepository();
      repository.seed(baseConversation());
      const aiProvider = new FakeAiProvider();
      const { useCase } = buildUseCase({ repository, aiProvider });

      await useCase.execute(
        baseCommand({ transcript: "It's Smith, S-M-I-T-H", sttConfidence: 0.4 }),
      );

      const sentMessage = aiProvider.requests[0]?.messages[0];
      expect(sentMessage?.content).toContain("speech-to-text confidence was low");
      expect(sentMessage?.content).toContain("It's Smith, S-M-I-T-H");
      const saved = await repository.findById("tenant-1", "conv-1");
      expect(saved?.transcript[0]?.text).toBe("It's Smith, S-M-I-T-H");
    });

    it("does NOT flag a normal-confidence transcript", async () => {
      const repository = new FakeConversationRepository();
      repository.seed(baseConversation());
      const aiProvider = new FakeAiProvider();
      const { useCase } = buildUseCase({ repository, aiProvider });

      await useCase.execute(baseCommand({ transcript: "hi there", sttConfidence: 0.95 }));

      expect(aiProvider.requests[0]?.messages[0]?.content).toBe("hi there");
    });

    it("does NOT flag a transcript with no confidence score reported at all — silence isn't evidence of low confidence", async () => {
      const repository = new FakeConversationRepository();
      repository.seed(baseConversation());
      const aiProvider = new FakeAiProvider();
      const { useCase } = buildUseCase({ repository, aiProvider });

      await useCase.execute(baseCommand({ transcript: "hi there", sttConfidence: undefined }));

      expect(aiProvider.requests[0]?.messages[0]?.content).toBe("hi there");
    });
  });

  it("throws ConversationNotFoundError for an unknown conversation", async () => {
    const { useCase } = buildUseCase();

    await expect(useCase.execute(baseCommand({ conversationId: "missing" }))).rejects.toThrow(
      ConversationNotFoundError,
    );
  });

  it("throws ConversationAlreadyEndedError once the conversation has ended", async () => {
    const repository = new FakeConversationRepository();
    repository.seed(
      baseConversation({ endedAt: new Date().toISOString(), endReason: "caller_hangup" }),
    );
    const { useCase } = buildUseCase({ repository });

    await expect(useCase.execute(baseCommand())).rejects.toThrow(ConversationAlreadyEndedError);
  });

  it("runs the tool-call loop: executes a requested tool, feeds the result back, and returns the model's follow-up text", async () => {
    const repository = new FakeConversationRepository();
    repository.seed(baseConversation());
    const aiProvider = new FakeAiProvider();
    aiProvider.responses = [
      [
        {
          type: "tool_call",
          toolCall: { id: "call-1", name: "searchCustomer", arguments: { phone: "+15551234567" } },
        },
        { type: "done", stopReason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "Found you!" },
        { type: "done", stopReason: "end_turn" },
      ],
    ];
    const toolExecuted = jest.fn().mockResolvedValue({ found: true });
    const { useCase, eventBus } = buildUseCase({
      aiProvider,
      repository,
      registeredTools: [{ name: "searchCustomer", handler: { execute: toolExecuted } }],
    });

    const result = await useCase.execute(
      baseCommand({ transcript: "It's Jane, phone is 555-1234", allowedTools: ["searchCustomer"] }),
    );

    expect(toolExecuted).toHaveBeenCalledTimes(1);
    expect(result.toolCallsExecuted).toEqual(["searchCustomer"]);
    expect(result.responseText).toBe("Found you!");
    expect(eventBus.eventsOfType("tool.called")).toHaveLength(1);
    expect(eventBus.eventsOfType("tool.completed")).toHaveLength(1);
  });

  /**
   * Regression coverage for a real bug found live running a full scenario
   * battery: `responseText += turn.text` across tool-loop iterations glued
   * text segments together with no separator whenever BOTH the pre-tool
   * and post-tool segments carried real text — "pulling up your
   * account.I'm having a quick technical hiccup," "your phone
   * number?Let me check if this is truly an emergency." The prior test
   * above doesn't catch this because its pre-tool segment is empty; this
   * one exercises the case that actually broke.
   */
  it("joins text segments from different tool-loop iterations with a space, not a raw concatenation", async () => {
    const repository = new FakeConversationRepository();
    repository.seed(baseConversation());
    const aiProvider = new FakeAiProvider();
    aiProvider.responses = [
      [
        { type: "text_delta", text: "Let me pull up your account." },
        {
          type: "tool_call",
          toolCall: { id: "call-1", name: "searchCustomer", arguments: { phone: "+15551234567" } },
        },
        { type: "done", stopReason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "What's your name?" },
        { type: "done", stopReason: "end_turn" },
      ],
    ];
    const toolExecuted = jest.fn().mockResolvedValue({ found: false });
    const { useCase } = buildUseCase({
      aiProvider,
      repository,
      registeredTools: [{ name: "searchCustomer", handler: { execute: toolExecuted } }],
    });

    const result = await useCase.execute(
      baseCommand({ transcript: "I need a plumber", allowedTools: ["searchCustomer"] }),
    );

    expect(result.responseText).toBe("Let me pull up your account. What's your name?");
  });

  it("publishes a lead.created event and records leadId on the conversation when createLead succeeds", async () => {
    const repository = new FakeConversationRepository();
    repository.seed(baseConversation());
    const aiProvider = new FakeAiProvider();
    aiProvider.responses = [
      [
        { type: "tool_call", toolCall: { id: "call-1", name: "createLead", arguments: {} } },
        { type: "done", stopReason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "All set." },
        { type: "done", stopReason: "end_turn" },
      ],
    ];
    const createLeadHandler = {
      execute: jest.fn().mockResolvedValue({ lead_id: "lead-1", status: "created" }),
    };
    const {
      useCase,
      eventBus,
      repository: repo,
    } = buildUseCase({
      aiProvider,
      repository,
      registeredTools: [{ name: "createLead", handler: createLeadHandler }],
    });

    await useCase.execute(
      baseCommand({ transcript: "please create the lead", allowedTools: ["createLead"] }),
    );

    expect(eventBus.eventsOfType("lead.created")).toHaveLength(1);
    const saved = await repo.findById("tenant-1", "conv-1");
    expect(saved?.leadId).toBe("lead-1");
  });

  it("surfaces escalation on the result when escalateEmergency succeeds with isEmergency true", async () => {
    const repository = new FakeConversationRepository();
    repository.seed(baseConversation());
    const aiProvider = new FakeAiProvider();
    aiProvider.responses = [
      [
        {
          type: "tool_call",
          toolCall: { id: "call-1", name: "escalateEmergency", arguments: {} },
        },
        { type: "done", stopReason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "Connecting you now." },
        { type: "done", stopReason: "end_turn" },
      ],
    ];
    const escalateHandler = {
      execute: jest.fn().mockResolvedValue({
        isEmergency: true,
        severity: "critical",
        action: "forward_call",
        transferDestination: "+15559876543",
      }),
    };
    const { useCase } = buildUseCase({
      aiProvider,
      repository,
      registeredTools: [{ name: "escalateEmergency", handler: escalateHandler }],
    });

    const result = await useCase.execute(
      baseCommand({ transcript: "burst pipe flooding now", allowedTools: ["escalateEmergency"] }),
    );

    // transferDestination (the real, currently-on-call phone number core-api
    // resolved via ResolveOnCallUseCase) must flow all the way through to
    // the HTTP-visible result — this is what lets the Voice Runtime
    // actually transfer to the right destination instead of falling back
    // to its own static env var.
    expect(result.escalation).toEqual({
      severity: "critical",
      action: "forward_call",
      transferDestination: "+15559876543",
    });
  });

  it("surfaces escalation with transferDestination: null when core-api couldn't resolve an on-call target", async () => {
    const repository = new FakeConversationRepository();
    repository.seed(baseConversation());
    const aiProvider = new FakeAiProvider();
    aiProvider.responses = [
      [
        {
          type: "tool_call",
          toolCall: { id: "call-1", name: "escalateEmergency", arguments: {} },
        },
        { type: "done", stopReason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "Connecting you now." },
        { type: "done", stopReason: "end_turn" },
      ],
    ];
    const escalateHandler = {
      execute: jest.fn().mockResolvedValue({
        isEmergency: true,
        severity: "critical",
        action: "forward_call",
        transferDestination: null,
      }),
    };
    const { useCase } = buildUseCase({
      aiProvider,
      repository,
      registeredTools: [{ name: "escalateEmergency", handler: escalateHandler }],
    });

    const result = await useCase.execute(
      baseCommand({ transcript: "burst pipe flooding now", allowedTools: ["escalateEmergency"] }),
    );

    expect(result.escalation).toEqual({
      severity: "critical",
      action: "forward_call",
      transferDestination: null,
    });
  });

  it("omits escalation from the result when no tool call escalates", async () => {
    const repository = new FakeConversationRepository();
    repository.seed(baseConversation());
    const { useCase } = buildUseCase({ repository });

    const result = await useCase.execute(baseCommand());

    expect(result.escalation).toBeUndefined();
  });

  it("stops the loop and marks interrupted when the abort signal fires mid-stream", async () => {
    const repository = new FakeConversationRepository();
    repository.seed(baseConversation());
    const controller = new AbortController();
    const aiProvider: FakeAiProvider = new FakeAiProvider();
    // Simulate the stream throwing once aborted, matching what a real
    // fetch-based provider does when its AbortSignal fires mid-read.
    aiProvider.streamCompletion = async function* (): AsyncIterable<AiCompletionChunk> {
      yield { type: "text_delta", text: "Sorry, let me" };
      controller.abort();
      throw new DOMException("aborted", "AbortError");
    };
    const { useCase } = buildUseCase({ aiProvider, repository });

    const result = await useCase.execute(
      baseCommand({ transcript: "wait, actually", signal: controller.signal }),
    );

    expect(result.interrupted).toBe(true);
    expect(result.responseText).toBe("Sorry, let me");
  });

  /**
   * Regression coverage for a real, live-reproducible bug found while
   * auditing the complete inbound-call path end to end: with every LLM
   * provider unavailable (this exact repo's own local dev environment has
   * zero OPENAI_API_KEY/ANTHROPIC_API_KEY/GEMINI_API_KEY configured right
   * now), FallbackAiProvider yields a single `{type: "error"}` chunk and
   * nothing else. Before this fix, that produced a "successful" 200
   * HandleTurnResult with responseText: "" and interrupted: false — the
   * Voice Runtime's `if (turnResult.responseText) { speak(...) }` treats
   * that as "nothing to say," leaving a real caller in silent dead air
   * indefinitely, with no apology and no retry ever triggered.
   */
  it("THROWS (rather than silently returning an empty success) when the AI provider layer reports an error and produces no usable text or tool calls", async () => {
    const repository = new FakeConversationRepository();
    repository.seed(baseConversation());
    const aiProvider = new FakeAiProvider();
    aiProvider.responses = [
      [
        {
          type: "error",
          message: "All AI providers failed or are unavailable: ",
          retryable: false,
        },
      ],
    ];
    const { useCase } = buildUseCase({ aiProvider, repository });

    await expect(useCase.execute(baseCommand())).rejects.toThrow(/AI provider completion failed/);
  });

  it("does NOT throw when a provider error arrives only AFTER real text already streamed — that partial text is preserved, not discarded", async () => {
    const repository = new FakeConversationRepository();
    repository.seed(baseConversation());
    const aiProvider = new FakeAiProvider();
    aiProvider.responses = [
      [
        { type: "text_delta", text: "Let me check that for" },
        { type: "error", message: "connection reset mid-stream", retryable: false },
      ],
    ];
    const { useCase } = buildUseCase({ aiProvider, repository });

    const result = await useCase.execute(baseCommand());

    expect(result.responseText).toBe("Let me check that for");
    expect(result.interrupted).toBe(false);
  });

  it("compresses the message history before each provider call once it exceeds the context window", async () => {
    const repository = new FakeConversationRepository();
    const longHistory = Array.from({ length: 45 }, (_unused, index) => ({
      role: "user" as const,
      content: `old message ${index}`,
    }));
    repository.seed(baseConversation({ messages: longHistory }));
    const aiProvider = new FakeAiProvider();
    const { useCase } = buildUseCase({ aiProvider, repository });

    await useCase.execute(baseCommand({ transcript: "one more thing" }));

    const sentMessages = aiProvider.requests[0]?.messages ?? [];
    expect(sentMessages.length).toBeLessThan(longHistory.length + 1);
  });

  describe("lost CAS race against a concurrent conversation write", () => {
    // Regression tests for a real bug: a turn's runTurn() can take seconds
    // (LLM streaming, tool calls) between reading the conversation and its
    // final save() — long enough for the caller to hang up mid-turn and
    // EndConversationUseCase to save first. Without a CAS, this turn's
    // final save() would silently last-write-wins clobber `endedAt` back to
    // null, resurrecting an ended conversation.

    it("discards this turn's state update without throwing when the conversation ended mid-turn", async () => {
      const repository = new FakeConversationRepository();
      const seeded = baseConversation();
      repository.seed(seeded);
      const { useCase } = buildUseCase({ repository });
      const originalSave = repository.save.bind(repository);
      repository.save = async (conversation) => {
        // Simulate EndConversationUseCase winning the race right as this
        // turn's own final save() runs.
        await originalSave({
          ...seeded,
          state: "ended",
          endedAt: "2026-01-01T00:00:00.000Z",
          endReason: "caller_hangup",
        });
        return originalSave(conversation);
      };

      // The response text was very likely already streamed to the caller
      // before the hangup was processed — the turn must still return it,
      // not throw, even though its state update is about to be discarded.
      const result = await useCase.execute(baseCommand());
      expect(result.responseText).toBe("hi");

      const stored = await repository.findById("tenant-1", "conv-1");
      expect(stored?.endedAt).toBe("2026-01-01T00:00:00.000Z");
      expect(stored?.endReason).toBe("caller_hangup");
      // This turn's own transcript update must NOT have been written on
      // top of — the ended conversation must not be resurrected.
      expect(stored?.state).toBe("ended");
    });

    it("retries once and succeeds when a benign concurrent write (not an end) landed first, preserving that write's state", async () => {
      const repository = new FakeConversationRepository();
      const seeded = baseConversation();
      repository.seed(seeded);
      const { useCase } = buildUseCase({ repository });
      const originalSave = repository.save.bind(repository);
      let firstAttempt = true;
      repository.save = async (conversation) => {
        if (firstAttempt) {
          firstAttempt = false;
          // A concurrent POST /:id/interrupt (TransitionConversationStateUseCase)
          // bumps the version and changes `state` without ending the conversation.
          await originalSave({ ...seeded, state: "identifying" });
        }
        return originalSave(conversation);
      };

      const result = await useCase.execute(baseCommand());

      expect(result.responseText).toBe("hi");
      const stored = await repository.findById("tenant-1", "conv-1");
      expect(stored?.transcript.map((t) => t.speaker)).toEqual(["caller", "agent"]);
      expect(stored?.endedAt).toBeNull();
      // This use case doesn't own `state` — the concurrent writer's value
      // must survive the retry, not get silently overwritten by this
      // turn's own stale ("greeting") copy of it.
      expect(stored?.state).toBe("identifying");
    });
  });

  describe("turn-level idempotency", () => {
    it("replaying the same idempotencyKey returns the cached result without re-invoking the AI provider", async () => {
      const repository = new FakeConversationRepository();
      repository.seed(baseConversation());
      const aiProvider = new FakeAiProvider();
      const { useCase } = buildUseCase({ aiProvider, repository });
      const command = baseCommand({ idempotencyKey: "retry-key" });

      const first = await useCase.execute(command);
      const second = await useCase.execute(command);

      expect(second).toEqual(first);
      expect(aiProvider.requests).toHaveLength(1);
    });

    it("replaying the same idempotencyKey does not re-execute tool calls", async () => {
      const repository = new FakeConversationRepository();
      repository.seed(baseConversation());
      const aiProvider = new FakeAiProvider();
      aiProvider.responses = [
        [
          {
            type: "tool_call",
            toolCall: {
              id: "call-1",
              name: "searchCustomer",
              arguments: { phone: "+15551234567" },
            },
          },
          { type: "done", stopReason: "tool_use" },
        ],
        [
          { type: "text_delta", text: "Found you!" },
          { type: "done", stopReason: "end_turn" },
        ],
      ];
      const toolExecuted = jest.fn().mockResolvedValue({ found: true });
      const { useCase } = buildUseCase({
        aiProvider,
        repository,
        registeredTools: [{ name: "searchCustomer", handler: { execute: toolExecuted } }],
      });
      const command = baseCommand({
        idempotencyKey: "retry-key",
        allowedTools: ["searchCustomer"],
      });

      await useCase.execute(command);
      await useCase.execute(command);

      expect(toolExecuted).toHaveBeenCalledTimes(1);
    });

    it("throws TurnAlreadyInFlightError for a concurrent duplicate call with the same idempotencyKey", async () => {
      const repository = new FakeConversationRepository();
      repository.seed(baseConversation());
      const { useCase, idempotencyStore } = buildUseCase({ repository });
      const command = baseCommand({ idempotencyKey: "concurrent-key" });

      // Reserve the key directly, simulating a first call still in flight —
      // same technique execute-tool.use-case.spec.ts uses for its own
      // in-flight assertion.
      await idempotencyStore.begin(`turn:${command.conversationId}:${command.idempotencyKey}`);

      await expect(useCase.execute(command)).rejects.toThrow(TurnAlreadyInFlightError);
    });

    it("different idempotency keys are independent — each runs the model", async () => {
      const repository = new FakeConversationRepository();
      repository.seed(baseConversation());
      const aiProvider = new FakeAiProvider();
      const { useCase } = buildUseCase({ aiProvider, repository });

      await useCase.execute(baseCommand({ idempotencyKey: "key-a" }));
      await useCase.execute(baseCommand({ idempotencyKey: "key-b" }));

      expect(aiProvider.requests).toHaveLength(2);
    });

    it("releases the reservation on failure so a retry with the same key can proceed afterward", async () => {
      const repository = new FakeConversationRepository();
      repository.seed(baseConversation());
      const aiProvider = new FakeAiProvider();
      const { useCase, idempotencyStore } = buildUseCase({ aiProvider, repository });
      const command = baseCommand({ idempotencyKey: "failing-key" });
      const failingKey = `turn:${command.conversationId}:${command.idempotencyKey}`;
      const releaseSpy = jest.spyOn(idempotencyStore, "release");
      const saveError = new Error("repository save failed");
      jest.spyOn(repository, "save").mockRejectedValueOnce(saveError);

      await expect(useCase.execute(command)).rejects.toThrow(saveError);
      expect(releaseSpy).toHaveBeenCalledWith(failingKey);

      // The reservation was released, so this retry proceeds and re-invokes
      // the model rather than hanging behind a permanently in-flight key.
      const result = await useCase.execute(command);
      expect(result.responseText).toBe("hi");
      expect(aiProvider.requests).toHaveLength(2);
    });
  });
});
