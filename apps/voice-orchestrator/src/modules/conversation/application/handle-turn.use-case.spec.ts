import type { AiCompletionChunk } from "../../ai-provider/domain/ai-provider.port";
import { ExecuteToolUseCase } from "../../tool-broker/application/execute-tool.use-case";
import { FakeIdempotencyStore } from "../../tool-broker/application/__fakes__/fake-idempotency-store";
import { FakeToolAuditLog } from "../../tool-broker/application/__fakes__/fake-tool-audit-log";
import { createNoopLogger as createNoopToolLogger } from "../../tool-broker/application/__fakes__/fake-logger";
import { ToolRegistry } from "../../tool-broker/application/tool-registry";
import type { ToolDefinition } from "../../tool-broker/domain/tool-definition";
import type { Conversation } from "../domain/conversation.entity";
import { ConversationAlreadyEndedError, ConversationNotFoundError } from "../domain/errors";
import { FakeAiProvider } from "./__fakes__/fake-ai-provider";
import { FakeConversationRepository } from "./__fakes__/fake-conversation-repository";
import { FakeEventBus } from "./__fakes__/fake-event-bus";
import { createNoopLogger } from "./__fakes__/fake-logger";
import { HandleTurnUseCase } from "./handle-turn.use-case";

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
    endReason: null,
    ...overrides,
  };
}

function buildUseCase(options?: {
  aiProvider?: FakeAiProvider;
  repository?: FakeConversationRepository;
  eventBus?: FakeEventBus;
  registeredTools?: Array<{
    name: string;
    handler: { execute: (input: unknown, ctx: unknown) => Promise<unknown> };
  }>;
}) {
  const repository = options?.repository ?? new FakeConversationRepository();
  const aiProvider = options?.aiProvider ?? new FakeAiProvider();
  const eventBus = options?.eventBus ?? new FakeEventBus();
  const toolRegistry = new ToolRegistry();
  for (const tool of options?.registeredTools ?? []) {
    toolRegistry.register(fakeToolDefinition(tool.name), tool.handler);
  }
  const executeTool = new ExecuteToolUseCase(
    toolRegistry,
    new FakeIdempotencyStore(),
    new FakeToolAuditLog(),
    createNoopToolLogger(),
  );
  const useCase = new HandleTurnUseCase(
    repository,
    aiProvider,
    executeTool,
    toolRegistry,
    eventBus,
    createNoopLogger(),
  );
  return { useCase, repository, aiProvider, eventBus, toolRegistry };
}

describe("HandleTurnUseCase", () => {
  it("appends the caller's transcript, streams the model's reply, and appends that too", async () => {
    const repository = new FakeConversationRepository();
    repository.seed(baseConversation());
    const { useCase } = buildUseCase({ repository });

    const result = await useCase.execute({
      tenantId: "tenant-1",
      conversationId: "conv-1",
      transcript: "Hi, my water heater is broken",
      allowedTools: [],
    });

    expect(result.responseText).toBe("hi");
    expect(result.interrupted).toBe(false);
    const saved = await repository.findById("tenant-1", "conv-1");
    expect(saved?.transcript.map((t) => t.speaker)).toEqual(["caller", "agent"]);
    expect(saved?.transcript[0]?.text).toBe("Hi, my water heater is broken");
  });

  it("throws ConversationNotFoundError for an unknown conversation", async () => {
    const { useCase } = buildUseCase();

    await expect(
      useCase.execute({
        tenantId: "tenant-1",
        conversationId: "missing",
        transcript: "hi",
        allowedTools: [],
      }),
    ).rejects.toThrow(ConversationNotFoundError);
  });

  it("throws ConversationAlreadyEndedError once the conversation has ended", async () => {
    const repository = new FakeConversationRepository();
    repository.seed(
      baseConversation({ endedAt: new Date().toISOString(), endReason: "caller_hangup" }),
    );
    const { useCase } = buildUseCase({ repository });

    await expect(
      useCase.execute({
        tenantId: "tenant-1",
        conversationId: "conv-1",
        transcript: "hi",
        allowedTools: [],
      }),
    ).rejects.toThrow(ConversationAlreadyEndedError);
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

    const result = await useCase.execute({
      tenantId: "tenant-1",
      conversationId: "conv-1",
      transcript: "It's Jane, phone is 555-1234",
      allowedTools: ["searchCustomer"],
    });

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

    await useCase.execute({
      tenantId: "tenant-1",
      conversationId: "conv-1",
      transcript: "please create the lead",
      allowedTools: ["createLead"],
    });

    expect(eventBus.eventsOfType("lead.created")).toHaveLength(1);
    const saved = await repo.findById("tenant-1", "conv-1");
    expect(saved?.leadId).toBe("lead-1");
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

    const result = await useCase.execute({
      tenantId: "tenant-1",
      conversationId: "conv-1",
      transcript: "wait, actually",
      allowedTools: [],
      signal: controller.signal,
    });

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

    await useCase.execute({
      tenantId: "tenant-1",
      conversationId: "conv-1",
      transcript: "one more thing",
      allowedTools: [],
    });

    const sentMessages = aiProvider.requests[0]?.messages ?? [];
    expect(sentMessages.length).toBeLessThan(longHistory.length + 1);
  });
});
