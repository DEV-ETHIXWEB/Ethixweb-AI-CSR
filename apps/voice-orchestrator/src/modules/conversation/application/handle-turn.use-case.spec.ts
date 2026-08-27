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

  it("surfaces transferTargets on the turn result when escalateEmergency returns forward_call", async () => {
    const repository = new FakeConversationRepository();
    repository.seed(baseConversation());
    const aiProvider = new FakeAiProvider();
    aiProvider.responses = [
      [
        { type: "tool_call", toolCall: { id: "call-1", name: "escalateEmergency", arguments: {} } },
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
        transferTargets: ["+15551234567"],
      }),
    };
    const { useCase } = buildUseCase({
      aiProvider,
      repository,
      registeredTools: [{ name: "escalateEmergency", handler: escalateHandler }],
    });

    const result = await useCase.execute(
      baseCommand({ transcript: "there's a gas leak", allowedTools: ["escalateEmergency"] }),
    );

    expect(result.transferTargets).toEqual(["+15551234567"]);
  });

  it("leaves transferTargets null when no tool call escalates with forward_call", async () => {
    const repository = new FakeConversationRepository();
    repository.seed(baseConversation());
    const { useCase } = buildUseCase({ repository });

    const result = await useCase.execute(baseCommand({ transcript: "just a routine question" }));

    expect(result.transferTargets).toBeNull();
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
