import type { AiCompletionChunk } from "../../ai-provider/domain/ai-provider.port";
import { ProviderCompletionError } from "../../ai-provider/domain/errors";
import { ExecuteToolUseCase } from "../../tool-broker/application/execute-tool.use-case";
import { FakeIdempotencyStore } from "../../tool-broker/application/__fakes__/fake-idempotency-store";
import { FakeToolAuditLog } from "../../tool-broker/application/__fakes__/fake-tool-audit-log";
import { createNoopLogger as createNoopToolLogger } from "../../tool-broker/application/__fakes__/fake-logger";
import { ToolRegistry } from "../../tool-broker/application/tool-registry";
import type { ToolDefinition } from "../../tool-broker/domain/tool-definition";
import type { Conversation, TranscriptTurn } from "../domain/conversation.entity";
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

/** Alternating caller/agent filler turns — used by the missing-lead-reminder tests to cheaply satisfy `LEAD_REMINDER_AFTER_TURNS` without depending on any particular content. */
function fillerTranscript(count: number): TranscriptTurn[] {
  return Array.from({ length: count }, (_unused, index) => ({
    turnIndex: index,
    speaker: index % 2 === 0 ? "caller" : "agent",
    text: `turn ${index}`,
    confidence: null,
    offsetMs: 0,
    at: new Date().toISOString(),
  }));
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

  /**
   * Regression coverage for the voice-conversation-latency optimization's
   * headline finding: a real call's first LLM completion produced real
   * text alongside its tool calls, and that text sat unused for the
   * full duration of the tool round-trip and the second completion,
   * because the old contract only ever returned text once the ENTIRE
   * turn had finished. `onChunk` is the fix — purely additive (every
   * caller that omits it, the entire rest of this file, is unaffected)
   * and fires once per iteration with exactly that iteration's NEW
   * text, never the running total.
   */
  describe("onChunk streaming callback (additive — omitting it changes nothing)", () => {
    it("fires once per LLM completion iteration, with only that iteration's NEW text, not the cumulative total", async () => {
      const repository = new FakeConversationRepository();
      repository.seed(baseConversation());
      const aiProvider = new FakeAiProvider();
      aiProvider.responses = [
        [
          { type: "text_delta", text: "Let me pull up your account." },
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
      const chunks: string[] = [];

      const result = await useCase.execute(
        baseCommand({ transcript: "I need a plumber", allowedTools: ["searchCustomer"] }),
        (text) => chunks.push(text),
      );

      expect(chunks).toEqual(["Let me pull up your account.", "What's your name?"]);
      // The final return value is unaffected by streaming — still the
      // full joined result, exactly as every non-streaming caller gets.
      expect(result.responseText).toBe("Let me pull up your account. What's your name?");
    });

    it("never fires with an empty string (an iteration whose only output was a tool call, no text)", async () => {
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
      const chunks: string[] = [];

      await useCase.execute(
        baseCommand({ transcript: "It's Jane", allowedTools: ["searchCustomer"] }),
        (text) => chunks.push(text),
      );

      expect(chunks).toEqual(["Found you!"]);
    });

    it("fires once with the full cached responseText on an idempotent replay — the callback contract stays the same whether or not the LLM actually ran", async () => {
      const repository = new FakeConversationRepository();
      repository.seed(baseConversation());
      const { useCase } = buildUseCase({ repository });
      const command = baseCommand({ transcript: "Hi, my water heater is broken" });

      await useCase.execute(command); // first attempt, no callback
      const chunks: string[] = [];
      const replayed = await useCase.execute(command, (text) => chunks.push(text));

      expect(chunks).toEqual([replayed.responseText]);
    });

    /**
     * The actual "does the caller hear speech before the ENTIRE LLM turn
     * finishes" proof for the overwhelmingly common case: a turn with NO
     * tool call at all (a single completion/iteration). Before
     * `findSpeechSegmentBoundary` existed, `onChunk` only ever flushed
     * once per LOOP ITERATION — for exactly this single-iteration case,
     * that meant one flush AFTER the provider had already finished
     * streaming its entire response server-side, no earlier than the
     * pre-streaming contract ever was. Scripting several small
     * `text_delta` chunks (mirroring how a real provider actually
     * streams — a handful of tokens per delta, not the whole sentence at
     * once) is what makes this test meaningfully different from the
     * "fires once per iteration" test above, where each iteration's text
     * arrives as a single delta already short enough to never hit a
     * boundary before the end.
     */
    it("fires MULTIPLE times within a single LLM completion, at natural sentence boundaries, not only once at the very end", async () => {
      const repository = new FakeConversationRepository();
      repository.seed(baseConversation());
      const aiProvider = new FakeAiProvider();
      aiProvider.responses = [
        [
          { type: "text_delta", text: "Okay, I completely understand" },
          { type: "text_delta", text: " how frustrating that must be for you. " },
          { type: "text_delta", text: "Let me ask you one quick question: " },
          { type: "text_delta", text: "is the unit blowing warm air, " },
          { type: "text_delta", text: "or barely any air at all?" },
          { type: "done", stopReason: "end_turn" },
        ],
      ];
      const { useCase } = buildUseCase({ aiProvider, repository });
      const chunks: string[] = [];

      const result = await useCase.execute(
        baseCommand({ transcript: "My AC stopped cooling" }),
        (text) => chunks.push(text),
      );

      // MORE than one chunk from this single completion — the actual
      // proof that speech starts before the whole turn finished
      // generating, not just before the whole TOOL LOOP finished. The
      // first sentence alone is 67 characters (well past
      // MIN_SPEECH_SEGMENT_CHARS), so it flushes as its own segment
      // instead of waiting for the second sentence too.
      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks[0]).toBe("Okay, I completely understand how frustrating that must be for you.");
      // Every chunk is a real sentence/clause, not a lone word or a
      // ragged one-character fragment — Step 3's own "bad" example.
      for (const chunk of chunks) {
        expect(chunk.trim().length).toBeGreaterThanOrEqual(10);
      }
      // Nothing lost, nothing duplicated, nothing reordered — joining
      // every chunk back together reproduces the exact full response.
      const fullText =
        "Okay, I completely understand how frustrating that must be for you. Let me ask you one quick question: is the unit blowing warm air, or barely any air at all?";
      expect(chunks.join("")).toBe(fullText);
      expect(result.responseText).toBe(fullText);
    });

    it("never splits a decimal number or a time-of-day abbreviation across two spoken chunks", async () => {
      const repository = new FakeConversationRepository();
      repository.seed(baseConversation());
      const aiProvider = new FakeAiProvider();
      aiProvider.responses = [
        [
          {
            type: "text_delta",
            text:
              "That service call is typically around $3.50 per mile, and we're open 9 a.m. to 5 p.m. " +
              "on weekdays, so someone can definitely get out to you today if you'd like.",
          },
          { type: "done", stopReason: "end_turn" },
        ],
      ];
      const { useCase } = buildUseCase({ aiProvider, repository });
      const chunks: string[] = [];

      await useCase.execute(baseCommand({ transcript: "How much does a visit cost" }), (text) =>
        chunks.push(text),
      );

      // The actual failure mode this guards against: without it, the
      // period in "a.m." that's followed by whitespace (the one right
      // before "to") looks exactly like a sentence end to the base
      // regex, splitting the coherent time-range phrase into "...9
      // a.m." as one chunk and "to 5 p.m. on weekdays..." as the next —
      // two disconnected, confusing fragments when spoken. Neither
      // "$3.50" nor "9 a.m. to 5 p.m." should ever be broken across a
      // chunk boundary — each must appear intact within a single chunk.
      expect(chunks.some((chunk) => chunk.includes("$3.50"))).toBe(true);
      expect(chunks.some((chunk) => chunk.includes("9 a.m. to 5 p.m."))).toBe(true);
    });
  });

  /**
   * Found live on a real ~21-minute, 99-turn call — the caller gave a
   * name and always had a real Caller ANI on file, declined to give an
   * address, and asked for a callback, yet createCustomer/createLead
   * were never called at all. Reproduced fresh in a 3-turn test right
   * after fixing the prompt alone (v19) proved insufficient on its own:
   * prompt wording has a reliability ceiling, the same lesson already
   * applied to escalateEmergency/searchCustomer. This never fabricates
   * the tool call with guessed data — only makes sure the model's own
   * attention doesn't drift from a pending action it alone has the real
   * data to complete.
   */
  describe("missing-lead reminder (LEAD_REMINDER_AFTER_TURNS)", () => {
    it("annotates the caller's message once the conversation has gone on long enough with no lead ever attempted", async () => {
      const repository = new FakeConversationRepository();
      const priorTranscript = fillerTranscript(6);
      repository.seed(baseConversation({ transcript: priorTranscript }));
      const aiProvider = new FakeAiProvider();
      aiProvider.responses = [
        [
          { type: "text_delta", text: "Sure, what's your address?" },
          { type: "done", stopReason: "end_turn" },
        ],
      ];
      const { useCase } = buildUseCase({ aiProvider, repository });

      await useCase.execute(baseCommand({ transcript: "no problem, call me back" }));

      const sentMessage = aiProvider.requests[0]?.messages[0];
      expect(sentMessage?.content).toContain("no customer/lead record has been created yet");
      expect(sentMessage?.content).toContain("no problem, call me back");
    });

    it("does NOT annotate before the turn threshold — a short call gets no reminder yet", async () => {
      const repository = new FakeConversationRepository();
      repository.seed(baseConversation({ transcript: [] }));
      const aiProvider = new FakeAiProvider();
      const { useCase } = buildUseCase({ aiProvider, repository });

      await useCase.execute(baseCommand({ transcript: "hi, my sink is clogged" }));

      const sentMessage = aiProvider.requests[0]?.messages[0];
      expect(sentMessage?.content).toBe("hi, my sink is clogged");
    });

    it("does NOT annotate once a lead has already been attempted this conversation", async () => {
      const repository = new FakeConversationRepository();
      const priorTranscript = fillerTranscript(6);
      repository.seed(baseConversation({ transcript: priorTranscript, leadEverAttempted: true }));
      const aiProvider = new FakeAiProvider();
      const { useCase } = buildUseCase({ aiProvider, repository });

      await useCase.execute(baseCommand({ transcript: "here's my address" }));

      const sentMessage = aiProvider.requests[0]?.messages[0];
      expect(sentMessage?.content).toBe("here's my address");
    });

    it("never leaks the reminder annotation into the DURABLE transcript record — only the model-facing copy", async () => {
      const repository = new FakeConversationRepository();
      const priorTranscript = fillerTranscript(6);
      repository.seed(baseConversation({ transcript: priorTranscript }));
      const { useCase } = buildUseCase({ repository });

      await useCase.execute(baseCommand({ transcript: "no problem, call me back" }));

      const saved = await repository.findById("tenant-1", "conv-1");
      const lastCallerTurn = saved?.transcript.filter((t) => t.speaker === "caller").pop();
      expect(lastCallerTurn?.text).toBe("no problem, call me back");
    });

    it("marks leadEverAttempted true once createLead executes, silencing the reminder on the NEXT turn", async () => {
      const repository = new FakeConversationRepository();
      const priorTranscript = fillerTranscript(6);
      repository.seed(baseConversation({ transcript: priorTranscript }));
      const aiProvider = new FakeAiProvider();
      aiProvider.responses = [
        [
          {
            type: "tool_call",
            toolCall: {
              id: "call-1",
              name: "createLead",
              arguments: {
                customer_id: "cust-1",
                problem_summary: "clogged sink",
                priority: "routine",
                lead_type: "residential",
              },
            },
          },
          { type: "done", stopReason: "tool_use" },
        ],
        [
          { type: "text_delta", text: "Got it, sent over to the team." },
          { type: "done", stopReason: "end_turn" },
        ],
      ];
      const leadHandler = {
        execute: jest.fn().mockResolvedValue({ lead_id: "lead-1" }),
      };
      const { useCase, repository: repo } = buildUseCase({
        aiProvider,
        repository,
        registeredTools: [{ name: "createLead", handler: leadHandler }],
      });

      await useCase.execute(
        baseCommand({ transcript: "please submit it", allowedTools: ["createLead"] }),
      );

      const saved = await repo.findById("tenant-1", "conv-1");
      expect(saved?.leadEverAttempted).toBe(true);
      // The "does NOT annotate once a lead has already been attempted"
      // test above already proves that a seeded leadEverAttempted: true
      // silences the reminder — this test's own job is just proving a
      // real createLead execution actually SETS that flag.
    });
  });

  /**
   * Regression coverage for `admitTurn()`'s entire reason for existing:
   * a streaming HTTP layer (the controller) needs to know whether this
   * turn is even ADMISSIBLE — conversation exists, not ended, not
   * already in flight — strictly BEFORE it commits to writing a 200 and
   * starting a response body, because HTTP cannot change the status
   * code once that's happened. These prove the exact property that
   * safety depends on: the three error cases throw directly from
   * `admitTurn()` itself, with no `run()` ever obtained, and the two
   * success cases are correctly discriminated by `kind`.
   */
  describe("admitTurn (the pre-flight-checks/streaming split execute() is now built on)", () => {
    it("throws ConversationNotFoundError directly from admitTurn — before any run() exists to call", async () => {
      const { useCase } = buildUseCase();

      await expect(useCase.admitTurn(baseCommand({ conversationId: "missing" }))).rejects.toThrow(
        ConversationNotFoundError,
      );
    });

    it("throws ConversationAlreadyEndedError directly from admitTurn", async () => {
      const repository = new FakeConversationRepository();
      repository.seed(
        baseConversation({ endedAt: new Date().toISOString(), endReason: "caller_hangup" }),
      );
      const { useCase } = buildUseCase({ repository });

      await expect(useCase.admitTurn(baseCommand())).rejects.toThrow(ConversationAlreadyEndedError);
    });

    it("throws TurnAlreadyInFlightError directly from admitTurn for a concurrent duplicate idempotencyKey", async () => {
      const repository = new FakeConversationRepository();
      repository.seed(baseConversation());
      const idempotencyStore = new FakeIdempotencyStore();
      const { useCase } = buildUseCase({ repository, idempotencyStore });
      const command = baseCommand();

      const firstAdmission = await useCase.admitTurn(command);
      expect(firstAdmission.kind).toBe("live");

      await expect(useCase.admitTurn(command)).rejects.toThrow(TurnAlreadyInFlightError);
    });

    it('returns kind: "live" with a run() that executes and persists the turn exactly like execute() does', async () => {
      const repository = new FakeConversationRepository();
      repository.seed(baseConversation());
      const { useCase } = buildUseCase({ repository });
      const command = baseCommand({ transcript: "Hi, my water heater is broken" });

      const admission = await useCase.admitTurn(command);
      expect(admission.kind).toBe("live");
      if (admission.kind !== "live") throw new Error("unreachable");
      const chunks: string[] = [];
      const result = await admission.run((text) => chunks.push(text));

      expect(result.responseText).toBe("hi");
      expect(chunks).toEqual(["hi"]);
      const saved = await repository.findById("tenant-1", "conv-1");
      expect(saved?.transcript.map((t) => t.speaker)).toEqual(["caller", "agent"]);
    });

    it('returns kind: "cached" with the full result, no run(), on an idempotent replay', async () => {
      const repository = new FakeConversationRepository();
      repository.seed(baseConversation());
      const { useCase } = buildUseCase({ repository });
      const command = baseCommand({ transcript: "Hi, my water heater is broken" });

      await useCase.execute(command);
      const replay = await useCase.admitTurn(command);

      expect(replay.kind).toBe("cached");
      if (replay.kind !== "cached") throw new Error("unreachable");
      expect(replay.result.responseText).toBe("hi");
      expect("run" in replay).toBe(false);
    });
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

  /**
   * Regression coverage for the most serious live finding of the whole
   * scenario battery: running the SAME unambiguous "pipe burst ...
   * flooding fast" description 10 times against the real model, with the
   * prompt already saying to ALWAYS call escalateEmergency, still missed
   * the call entirely once — LLM sampling variance has a ceiling no
   * prompt wording alone closes. This proves the code-level backstop:
   * when the model ends its turn with no tool calls and escalateEmergency
   * has never been called this conversation, the loop substitutes a
   * synthetic escalateEmergency call for that iteration and runs one
   * more completion round, so the model still reacts/narrates naturally
   * — the SAME mechanism as if the model had called the tool itself.
   */
  it("force-calls escalateEmergency when the model ends its turn without ever having called it (deterministic safety net)", async () => {
    const repository = new FakeConversationRepository();
    repository.seed(baseConversation());
    const aiProvider = new FakeAiProvider();
    aiProvider.responses = [
      [
        { type: "text_delta", text: "Let's get you help right away." },
        { type: "done", stopReason: "end_turn" },
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
      baseCommand({
        transcript: "a pipe burst in my basement and it's flooding fast",
        allowedTools: ["escalateEmergency"],
      }),
    );

    expect(escalateHandler.execute).toHaveBeenCalledTimes(1);
    expect(escalateHandler.execute.mock.calls[0]?.[0]).toEqual({
      description: "a pipe burst in my basement and it's flooding fast",
    });
    expect(result.toolCallsExecuted).toEqual(["escalateEmergency"]);
    expect(result.escalation).toEqual({
      severity: "critical",
      action: "forward_call",
      transferDestination: "+15559876543",
    });
    expect(result.responseText).toBe("Let's get you help right away. Connecting you now.");
  });

  /**
   * Found live on a real ~10-minute phone call (turn 18 of 40): the
   * backstop fired a SECOND time mid-call, adding a full extra LLM
   * round-trip (measured: this exact turn's response time nearly doubled
   * vs. every neighboring turn). Root cause — `compressMessages`
   * (context-window.ts), which runs at the top of every `runTurn`
   * iteration once a long call passes its message-count threshold,
   * replaces old messages with a plain-text summary that drops the
   * `toolCalls` array entirely. `hasCalledEscalateEmergency` used to read
   * ONLY `conversation.messages`, so once the turn-1 backstop call's own
   * message got compacted away, the "have we ever checked" signal was
   * lost and the backstop fired again. This seeds a conversation shaped
   * exactly like that: `emergencyEverChecked: true` (set on the earlier
   * real turn) but `messages` long enough, and with the ORIGINAL
   * escalateEmergency tool-call message old enough, that this turn's own
   * `compressMessages` call drops it before the model ever runs.
   */
  it("does NOT re-fire the escalateEmergency backstop after compaction has dropped the earlier call's tool-call message", async () => {
    const repository = new FakeConversationRepository();
    const oldMessages: Conversation["messages"] = [
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "t1", name: "escalateEmergency", arguments: { description: "hi" } }],
      },
      { role: "tool", toolCallId: "t1", content: "{}" },
    ];
    for (let i = 0; i < 40; i++) {
      oldMessages.push({
        role: i % 2 === 0 ? "user" : "assistant",
        content: `filler turn ${i}`,
      });
    }
    repository.seed(baseConversation({ emergencyEverChecked: true, messages: oldMessages }));
    const escalateHandler = { execute: jest.fn() };
    const { useCase } = buildUseCase({
      repository,
      registeredTools: [{ name: "escalateEmergency", handler: escalateHandler }],
    });

    const result = await useCase.execute(
      baseCommand({ transcript: "okay thanks", allowedTools: ["escalateEmergency"] }),
    );

    expect(escalateHandler.execute).not.toHaveBeenCalled();
    expect(result.toolCallsExecuted).toEqual([]);
  });

  /**
   * Found live on a real ~21-minute call: the escalateEmergency backstop
   * correctly fired once on turn 1 (an unrelated "not sure what's going
   * on" transcript), then the caller went on to describe an ACTIVE leak
   * from a "burst pipe" almost 20 minutes later — real content
   * DEFAULT_EMERGENCY_KEYWORDS' own "burst pipe" pattern would classify
   * as critical/forward_call — and the tool was never called again for
   * it, because the old "ever checked" gate treated turn 1's unrelated
   * check as covering the whole rest of the call.
   */
  it("re-fires the escalateEmergency backstop on a LATER turn whose transcript looks emergency-adjacent, even though an earlier unrelated turn already checked once", async () => {
    const repository = new FakeConversationRepository();
    repository.seed(baseConversation());
    const escalateHandler = {
      execute: jest.fn().mockResolvedValue({
        isEmergency: false,
        severity: "medium",
        action: "standard_lead",
        transferDestination: null,
      }),
    };
    const { useCase } = buildUseCase({
      repository,
      registeredTools: [{ name: "escalateEmergency", handler: escalateHandler }],
    });

    // Turn 1: unrelated, satisfies the old "ever checked" gate.
    await useCase.execute(
      baseCommand({
        transcript: "not sure what is going on",
        idempotencyKey: "turn-1",
        allowedTools: ["escalateEmergency"],
      }),
    );
    expect(escalateHandler.execute).toHaveBeenCalledTimes(1);

    // A much later turn describing an active leak — must be re-checked,
    // not silently skipped because turn 1 already "used up" the check.
    const result = await useCase.execute(
      baseCommand({
        transcript: "for that burst pipe, yeah it is happening right now",
        idempotencyKey: "turn-2",
        allowedTools: ["escalateEmergency"],
      }),
    );

    expect(escalateHandler.execute).toHaveBeenCalledTimes(2);
    expect(escalateHandler.execute.mock.calls[1]?.[0]).toEqual({
      description: "for that burst pipe, yeah it is happening right now",
    });
    expect(result.toolCallsExecuted).toEqual(["escalateEmergency"]);
  });

  it("does NOT re-fire the backstop a second time within the SAME turn's own multiple completion iterations, even though that turn's own transcript looks emergency-adjacent", async () => {
    const repository = new FakeConversationRepository();
    repository.seed(baseConversation());
    const aiProvider = new FakeAiProvider();
    aiProvider.responses = [
      [
        { type: "text_delta", text: "Let's get that shut off right away." },
        { type: "done", stopReason: "end_turn" },
      ],
      [
        { type: "text_delta", text: "Have you shut off the valve yet?" },
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
      baseCommand({
        transcript: "there's a burst pipe leaking right now",
        allowedTools: ["escalateEmergency"],
      }),
    );

    // The SAME turn ran two completion iterations (both with no real tool
    // calls of their own) — escalateEmergency must only fire once for it,
    // not once per iteration.
    expect(escalateHandler.execute).toHaveBeenCalledTimes(1);
    expect(result.toolCallsExecuted).toEqual(["escalateEmergency"]);
  });

  it("does NOT re-fire the backstop on a later turn whose transcript does not look emergency-adjacent", async () => {
    const repository = new FakeConversationRepository();
    repository.seed(baseConversation());
    const escalateHandler = {
      execute: jest.fn().mockResolvedValue({
        isEmergency: false,
        severity: "medium",
        action: "standard_lead",
        transferDestination: null,
      }),
    };
    const { useCase } = buildUseCase({
      repository,
      registeredTools: [{ name: "escalateEmergency", handler: escalateHandler }],
    });

    await useCase.execute(
      baseCommand({
        transcript: "not sure what is going on",
        idempotencyKey: "turn-1",
        allowedTools: ["escalateEmergency"],
      }),
    );
    expect(escalateHandler.execute).toHaveBeenCalledTimes(1);

    const result = await useCase.execute(
      baseCommand({
        transcript: "what's your zip code coverage look like",
        idempotencyKey: "turn-2",
        allowedTools: ["escalateEmergency"],
      }),
    );

    expect(escalateHandler.execute).toHaveBeenCalledTimes(1); // still just the turn-1 check
    expect(result.toolCallsExecuted).toEqual([]);
  });

  /**
   * Found live on a real ~7-minute phone call: a valid caller ANI was
   * present the ENTIRE call, searchCustomer's own tool description calls
   * it "First tool called on every inbound call," and the platform prompt
   * says the same — yet the model never called it once across 17 turns.
   * The exact same LLM-sampling-variance gap the escalateEmergency
   * backstop already closes, just never extended to this tool. Mirrors
   * that test's own shape.
   */
  it("force-calls searchCustomer when the model ends its turn without ever having called it and a caller ANI is on file (deterministic safety net)", async () => {
    const repository = new FakeConversationRepository();
    repository.seed(baseConversation({ callerAni: "+15558127744" }));
    const aiProvider = new FakeAiProvider();
    aiProvider.responses = [
      [
        { type: "text_delta", text: "Hey there, what's going on?" },
        { type: "done", stopReason: "end_turn" },
      ],
      [
        { type: "text_delta", text: "Got it." },
        { type: "done", stopReason: "end_turn" },
      ],
    ];
    const searchHandler = {
      execute: jest.fn().mockResolvedValue({ found: false }),
    };
    const { useCase } = buildUseCase({
      aiProvider,
      repository,
      registeredTools: [{ name: "searchCustomer", handler: searchHandler }],
    });

    const result = await useCase.execute(
      baseCommand({ transcript: "hi", allowedTools: ["searchCustomer"] }),
    );

    expect(searchHandler.execute).toHaveBeenCalledTimes(1);
    expect(searchHandler.execute.mock.calls[0]?.[0]).toEqual({ phone: "+15558127744" });
    expect(result.toolCallsExecuted).toEqual(["searchCustomer"]);
  });

  it("does NOT force-call searchCustomer when no caller ANI is on file for this conversation", async () => {
    const repository = new FakeConversationRepository();
    repository.seed(baseConversation());
    const searchHandler = { execute: jest.fn() };
    const { useCase } = buildUseCase({
      repository,
      registeredTools: [{ name: "searchCustomer", handler: searchHandler }],
    });

    const result = await useCase.execute(
      baseCommand({ transcript: "hi", allowedTools: ["searchCustomer"] }),
    );

    expect(searchHandler.execute).not.toHaveBeenCalled();
    expect(result.toolCallsExecuted).toEqual([]);
  });

  it("does NOT force-call searchCustomer when it isn't in this call's allowedTools, even with a caller ANI on file", async () => {
    const repository = new FakeConversationRepository();
    repository.seed(baseConversation({ callerAni: "+15558127744" }));
    const searchHandler = { execute: jest.fn() };
    const { useCase } = buildUseCase({
      repository,
      registeredTools: [{ name: "searchCustomer", handler: searchHandler }],
    });

    const result = await useCase.execute(baseCommand({ transcript: "hi", allowedTools: [] }));

    expect(searchHandler.execute).not.toHaveBeenCalled();
    expect(result.toolCallsExecuted).toEqual([]);
  });

  it("fires BOTH the searchCustomer and escalateEmergency backstops in the same iteration when both are outstanding", async () => {
    const repository = new FakeConversationRepository();
    repository.seed(baseConversation({ callerAni: "+15558127744" }));
    const aiProvider = new FakeAiProvider();
    aiProvider.responses = [
      [
        { type: "text_delta", text: "Hey there, what's going on?" },
        { type: "done", stopReason: "end_turn" },
      ],
      [
        { type: "text_delta", text: "Got it." },
        { type: "done", stopReason: "end_turn" },
      ],
    ];
    const searchHandler = { execute: jest.fn().mockResolvedValue({ found: false }) };
    const escalateHandler = {
      execute: jest.fn().mockResolvedValue({
        isEmergency: false,
        severity: "medium",
        action: "standard_lead",
        transferDestination: null,
      }),
    };
    const { useCase } = buildUseCase({
      aiProvider,
      repository,
      registeredTools: [
        { name: "searchCustomer", handler: searchHandler },
        { name: "escalateEmergency", handler: escalateHandler },
      ],
    });

    const result = await useCase.execute(
      baseCommand({ transcript: "hi", allowedTools: ["searchCustomer", "escalateEmergency"] }),
    );

    expect(searchHandler.execute).toHaveBeenCalledTimes(1);
    expect(escalateHandler.execute).toHaveBeenCalledTimes(1);
    expect(result.toolCallsExecuted).toEqual(["searchCustomer", "escalateEmergency"]);
  });

  /**
   * Same compaction bug class as `emergencyEverChecked` (see that field's
   * own comment) — proves `searchCustomerEverChecked` independently
   * survives `compressMessages` dropping the earlier turn's tool-call
   * message.
   */
  it("does NOT re-fire the searchCustomer backstop after compaction has dropped the earlier call's tool-call message", async () => {
    const repository = new FakeConversationRepository();
    const oldMessages: Conversation["messages"] = [
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "t1", name: "searchCustomer", arguments: { phone: "+15558127744" } }],
      },
      { role: "tool", toolCallId: "t1", content: "{}" },
    ];
    for (let i = 0; i < 40; i++) {
      oldMessages.push({
        role: i % 2 === 0 ? "user" : "assistant",
        content: `filler turn ${i}`,
      });
    }
    repository.seed(
      baseConversation({
        callerAni: "+15558127744",
        searchCustomerEverChecked: true,
        messages: oldMessages,
      }),
    );
    const searchHandler = { execute: jest.fn() };
    const { useCase } = buildUseCase({
      repository,
      registeredTools: [{ name: "searchCustomer", handler: searchHandler }],
    });

    const result = await useCase.execute(
      baseCommand({ transcript: "okay thanks", allowedTools: ["searchCustomer"] }),
    );

    expect(searchHandler.execute).not.toHaveBeenCalled();
    expect(result.toolCallsExecuted).toEqual([]);
  });

  it("does NOT force-call escalateEmergency when it isn't in this call's allowedTools", async () => {
    const repository = new FakeConversationRepository();
    repository.seed(baseConversation());
    const escalateHandler = { execute: jest.fn() };
    const { useCase } = buildUseCase({
      repository,
      registeredTools: [{ name: "escalateEmergency", handler: escalateHandler }],
    });

    const result = await useCase.execute(
      baseCommand({ transcript: "just checking on my appointment", allowedTools: [] }),
    );

    expect(escalateHandler.execute).not.toHaveBeenCalled();
    expect(result.toolCallsExecuted).toEqual([]);
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

  /**
   * Regression coverage for a real cost found while tracing the role:"system"
   * compaction bug (anthropic.adapter.ts's own fix) all the way to the wire:
   * every adapter already computes a correct retryable/permanent
   * classification per error and yields it faithfully on the chunk, but this
   * use case previously threw a plain `Error` that discarded it, forcing
   * ConversationsController to hardcode `retryable: true` on every failure —
   * a genuinely permanent error still cost the caller a wasted retry cycle
   * before falling back to an apology. ProviderCompletionError carries that
   * classification the rest of the way instead of losing it here.
   */
  it("throws a ProviderCompletionError carrying the adapter's own retryable classification, not a plain Error that discards it", async () => {
    const repository = new FakeConversationRepository();
    repository.seed(baseConversation());
    const aiProvider = new FakeAiProvider();
    aiProvider.responses = [
      [{ type: "error", message: "malformed request (400): bad shape", retryable: false }],
    ];
    const { useCase } = buildUseCase({ aiProvider, repository });

    const error: unknown = await useCase.execute(baseCommand()).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ProviderCompletionError);
    expect((error as ProviderCompletionError).retryable).toBe(false);
  });

  it("still defaults to retryable: true for a transient provider error (e.g. a 5xx/overload), matching docs/28 §G", async () => {
    const repository = new FakeConversationRepository();
    repository.seed(baseConversation());
    const aiProvider = new FakeAiProvider();
    aiProvider.responses = [
      [{ type: "error", message: "anthropic overloaded (529)", retryable: true }],
    ];
    const { useCase } = buildUseCase({ aiProvider, repository });

    const error: unknown = await useCase.execute(baseCommand()).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ProviderCompletionError);
    expect((error as ProviderCompletionError).retryable).toBe(true);
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

  /**
   * QA mission failure-injection pass: the test above covers a
   * WELL-FORMED `{type:"error"}` chunk arriving mid-stream. This covers
   * the OTHER real failure shape — the provider's own async generator
   * genuinely THROWING mid-iteration, which every adapter's raw
   * `JSON.parse` on an SSE payload can do on a malformed vendor response
   * (confirmed live: a hand-crafted malformed data: line reproduces this
   * exact throw from anthropic.adapter.ts). This exercises
   * streamOneCompletion's own try/catch around the `for await` loop —
   * found with ZERO existing test coverage anywhere in this file despite
   * being a real, reachable path.
   */
  it("does NOT throw when the provider's stream genuinely THROWS (not a well-formed error chunk) after real text already streamed — same partial-text preservation as a well-formed error", async () => {
    const repository = new FakeConversationRepository();
    repository.seed(baseConversation());
    const aiProvider = new FakeAiProvider();
    aiProvider.responses = [[{ type: "text_delta", text: "Let me pull that up for" }]];
    aiProvider.throwAfterChunks = [new Error("Unexpected token in JSON at position 1")];
    const { useCase } = buildUseCase({ aiProvider, repository });

    const result = await useCase.execute(baseCommand());

    expect(result.responseText).toBe("Let me pull that up for");
    expect(result.interrupted).toBe(false);
  });

  it("throws (not silently succeeds with empty text) when the provider's stream throws BEFORE any usable text was produced", async () => {
    const repository = new FakeConversationRepository();
    repository.seed(baseConversation());
    const aiProvider = new FakeAiProvider();
    aiProvider.responses = [[]];
    aiProvider.throwAfterChunks = [new Error("connection reset before any bytes arrived")];
    const { useCase } = buildUseCase({ aiProvider, repository });

    await expect(useCase.execute(baseCommand())).rejects.toThrow(
      /connection reset before any bytes arrived/,
    );
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
