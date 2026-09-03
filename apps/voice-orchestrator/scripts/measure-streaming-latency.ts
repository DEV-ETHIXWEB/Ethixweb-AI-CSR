/**
 * REAL-PROVIDER streaming latency measurement — the voice-latency
 * optimization pass's Phase 2 "prove true streaming" requirement. Runs a
 * realistic multi-turn CSR conversation through the ACTUAL
 * `HandleTurnUseCase` (the exact same class the live `/turns` endpoint
 * uses) against the REAL Anthropic API — not `FakeAiProvider`, not a
 * synthetic timing model. Only the parts that would need a real core-api
 * deployment or a real Redis (conversation persistence, tool execution,
 * idempotency) are faked, matching the same "fake only true external I/O
 * this environment can't reach" convention as
 * `test/voice-runtime-simulator.ts` — the LLM call itself, the actual
 * thing being measured, is never faked.
 *
 * What this proves: whether `onChunk` (streamOneCompletion's
 * sentence-boundary flushing) actually fires BEFORE the whole completion
 * finishes generating, and by how much — the literal question Phase 2
 * asks, answered with real numbers instead of an assumption that
 * "streaming" + passing tests means the same thing as "the caller hears
 * speech sooner."
 *
 * What this does NOT prove (the true external boundary this script
 * cannot cross): the STT leg (speech end -> finalized transcript) and the
 * Twilio audio leg (voice-runtime -> caller's ear) both require a real
 * phone call over PSTN — no code in this repository can originate or
 * receive one. See docs/28 and this pass's own final report for that
 * boundary's REAL/SIMULATED/BLOCKED status.
 *
 * Run: pnpm exec ts-node -T scripts/measure-streaming-latency.ts
 * (from apps/voice-orchestrator — needs a real ANTHROPIC_API_KEY in
 * this package's .env, the same one the live service reads)
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { InMemoryIdempotencyStore } from "@ethixweb/shared-kernel";
import { AnthropicAdapter } from "../src/modules/ai-provider/infrastructure/anthropic.adapter";
import { HandleTurnUseCase } from "../src/modules/conversation/application/handle-turn.use-case";
import { FakeConversationRepository } from "../src/modules/conversation/application/__fakes__/fake-conversation-repository";
import { FakeEventBus } from "../src/modules/conversation/application/__fakes__/fake-event-bus";
import { createNoopLogger } from "../src/modules/conversation/application/__fakes__/fake-logger";
import { ExecuteToolUseCase } from "../src/modules/tool-broker/application/execute-tool.use-case";
import { ToolRegistry } from "../src/modules/tool-broker/application/tool-registry";
import { FakeToolAuditLog } from "../src/modules/tool-broker/application/__fakes__/fake-tool-audit-log";
import type { Conversation } from "../src/modules/conversation/domain/conversation.entity";
import type { HandleTurnCommand } from "../src/modules/conversation/application/handle-turn.use-case";

loadDotEnvIfPresent(join(__dirname, "..", ".env"));

const apiKey = process.env["ANTHROPIC_API_KEY"];
if (!apiKey) {
  console.error(
    "BLOCKED: ANTHROPIC_API_KEY is not set (checked process.env and apps/voice-orchestrator/.env). " +
      "This script measures REAL provider latency and refuses to fabricate numbers instead.",
  );
  process.exit(1);
}
const model = process.env["DEFAULT_LLM_MODEL"] ?? "claude-haiku-4-5";

const SYSTEM_PROMPT = [
  "You are a professional, warm customer service representative for All Phase Plumbing, a home-service plumbing company.",
  "Keep every response to 1-3 short sentences plus at most one question. Never use giant paragraphs.",
  "Speak naturally, like a skilled human CSR on the phone — acknowledge what the caller said, then move the conversation forward.",
  "Avoid starting every reply with 'Absolutely!' or 'Certainly!' or 'Great question!' — vary your acknowledgments or skip them when unnecessary.",
  "You have no tools available this conversation — just talk naturally and gather the caller's name, phone number, and the issue they're calling about.",
].join(" ");

/** A realistic 5-turn call, written to mirror actual caller speech patterns (short answers, a correction, a topic add-on) — not a scripted "ideal" transcript. */
const CALLER_TURNS = [
  "Hi, my air conditioner stopped cooling yesterday afternoon and it's getting pretty warm in here.",
  "It's blowing warm air, not really any cool air at all.",
  "Akash Kumar.",
  "Actually wait, my number is 555-201-4477, not what I said before.",
  "That's everything, thanks for your help.",
];

interface TurnMeasurement {
  turnIndex: number;
  callerText: string;
  requestStartedAt: number;
  chunkTimestampsMs: number[];
  chunkTexts: string[];
  doneAtMs: number;
  responseText: string;
}

async function main(): Promise<void> {
  const aiProvider = new AnthropicAdapter(apiKey, process.env["ANTHROPIC_BASE_URL"]);
  const repository = new FakeConversationRepository();
  const eventBus = new FakeEventBus();
  const idempotencyStore = new InMemoryIdempotencyStore();
  const toolRegistry = new ToolRegistry(); // empty — no tools this run, isolates pure LLM streaming latency
  const executeTool = new ExecuteToolUseCase(
    toolRegistry,
    new InMemoryIdempotencyStore(),
    new FakeToolAuditLog(),
    createNoopLogger(),
  );
  const logger = createNoopLogger();

  const useCase = new HandleTurnUseCase(
    repository,
    aiProvider,
    executeTool,
    toolRegistry,
    eventBus,
    idempotencyStore,
    logger,
  );

  const conversationId = randomUUID();
  const conversation: Conversation = {
    id: conversationId,
    tenantId: "measurement-tenant",
    businessId: "measurement-business",
    callId: randomUUID(),
    state: "qualifying",
    systemPrompt: SYSTEM_PROMPT,
    llmModel: model,
    messages: [],
    transcript: [],
    leadId: null,
    startedAt: new Date().toISOString(),
    endedAt: null,
    capacityReservationId: "measurement-reservation",
    endReason: null,
    version: 1,
  };
  repository.seed(conversation);

  console.log(`Model: ${model}`);
  console.log(`Turns: ${CALLER_TURNS.length}\n`);

  const measurements: TurnMeasurement[] = [];

  for (let i = 0; i < CALLER_TURNS.length; i++) {
    const callerText = CALLER_TURNS[i];
    const command: HandleTurnCommand = {
      tenantId: "measurement-tenant",
      conversationId,
      idempotencyKey: randomUUID(),
      transcript: callerText,
      allowedTools: [],
    };

    const requestStartedAt = Date.now();
    const chunkTimestampsMs: number[] = [];
    const chunkTexts: string[] = [];

    const result = await useCase.execute(command, (text) => {
      chunkTimestampsMs.push(Date.now() - requestStartedAt);
      chunkTexts.push(text);
    });
    const doneAtMs = Date.now() - requestStartedAt;

    measurements.push({
      turnIndex: i + 1,
      callerText,
      requestStartedAt,
      chunkTimestampsMs,
      chunkTexts,
      doneAtMs,
      responseText: result.responseText,
    });

    printTurn(i + 1, callerText, chunkTimestampsMs, chunkTexts, doneAtMs);
  }

  printSummary(measurements);
}

function printTurn(
  turnNumber: number,
  callerText: string,
  chunkTimestampsMs: number[],
  chunkTexts: string[],
  doneAtMs: number,
): void {
  console.log(`--- Turn ${turnNumber} ---`);
  console.log(`Caller: "${callerText}"`);
  if (chunkTimestampsMs.length === 0) {
    console.log("  (no chunks — empty response)");
  }
  for (let i = 0; i < chunkTimestampsMs.length; i++) {
    const label = i === 0 ? "first chunk" : `chunk ${i + 1}`;
    console.log(
      `  [+${chunkTimestampsMs[i]}ms] ${label} (${chunkTexts[i].length} chars): "${chunkTexts[i]}"`,
    );
  }
  console.log(`  [+${doneAtMs}ms] turn done (${chunkTimestampsMs.length} chunk(s) total)`);
  if (chunkTimestampsMs.length > 0) {
    const firstChunkMs = chunkTimestampsMs[0];
    const savedMs = doneAtMs - firstChunkMs;
    console.log(
      `  => speech could start ${savedMs}ms BEFORE the turn fully finished (${((savedMs / doneAtMs) * 100).toFixed(0)}% of total turn time)`,
    );
  }
  console.log("");
}

function printSummary(measurements: TurnMeasurement[]): void {
  console.log(
    "=== SUMMARY (real Anthropic API, real HandleTurnUseCase, real sentence-boundary chunking) ===",
  );
  const withChunks = measurements.filter((m) => m.chunkTimestampsMs.length > 0);
  const firstChunkTimes = withChunks.map((m) => m.chunkTimestampsMs[0]);
  const totalTimes = measurements.map((m) => m.doneAtMs);
  const chunkCounts = measurements.map((m) => m.chunkTimestampsMs.length);
  const multiChunkTurns = measurements.filter((m) => m.chunkTimestampsMs.length > 1).length;

  console.log(`Turns measured: ${measurements.length}`);
  console.log(`Turns with >1 streamed chunk: ${multiChunkTurns}/${measurements.length}`);
  console.log(`Chunk counts per turn: ${chunkCounts.join(", ")}`);
  console.log(
    `First-chunk latency (ms): min=${Math.min(...firstChunkTimes)} max=${Math.max(...firstChunkTimes)} avg=${avg(firstChunkTimes).toFixed(0)}`,
  );
  console.log(
    `Total turn duration (ms): min=${Math.min(...totalTimes)} max=${Math.max(...totalTimes)} avg=${avg(totalTimes).toFixed(0)}`,
  );
  const savedMsPerTurn = withChunks.map((m) => m.doneAtMs - m.chunkTimestampsMs[0]);
  console.log(
    `Time speech could start before full turn finished (ms): min=${Math.min(...savedMsPerTurn)} max=${Math.max(...savedMsPerTurn)} avg=${avg(savedMsPerTurn).toFixed(0)}`,
  );
}

function avg(nums: number[]): number {
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function loadDotEnvIfPresent(path: string): void {
  let content: string;
  try {
    content = readFileSync(path, "utf8");
  } catch {
    return;
  }
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) {
      continue;
    }
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

main().catch((error: unknown) => {
  console.error("Measurement run failed:", error);
  process.exit(1);
});
