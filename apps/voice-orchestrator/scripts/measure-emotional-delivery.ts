/**
 * REAL-MODEL evidence for the emotional-delivery prompt pass (v20,
 * prompt-layers.ts) — same posture as measure-conversation-quality.ts:
 * "does the model actually use [bracket] delivery cues, sparingly and in
 * context, and keep responses to one idea per turn" is a real model
 * behavior question a FakeAiProvider cannot answer, so this drives real
 * multi-turn conversations against the REAL Anthropic API with the REAL
 * v20 system prompt and prints the full transcript, plus a simple
 * automated scan of each response for [bracket] cues, for direct human
 * inspection.
 *
 * Scenarios cover the mission's own list where it's actually a TEXT
 * GENERATION question: normal conversation, frustrated customer,
 * emergency, a direct question, a correction, long vs. short caller
 * answers, topic change and return, an objection, and a repeat-something
 * request. Deliberately NOT covered here (out of scope for a real-model
 * TEXT script): interrupting Grace mid-sentence, double interruption,
 * backchannels, and the silence check-in — those are voice-runtime
 * audio/timer mechanics (VAD, barge-in, SILENCE_CHECK_IN_TIMEOUT_MS),
 * already covered by call-session-orchestrator.spec.ts's own live-verified
 * regression tests and a real phone call, not something a text-only
 * conversation loop can exercise meaningfully.
 *
 * Run: pnpm exec ts-node -T scripts/measure-emotional-delivery.ts
 * (from apps/voice-orchestrator — needs a real ANTHROPIC_API_KEY)
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
import { FakeToolHandler } from "../src/modules/tool-broker/application/__fakes__/fake-tool-handler";
import { TOOL_CATALOG } from "../src/modules/tool-broker/domain/tool-catalog";
import {
  assembleLayeredPrompt,
  PLATFORM_BASE_PROMPT_V1,
} from "../src/modules/prompt/domain/prompt-layers";
import { DEFAULT_BRAND_VOICE_PROMPT } from "../src/modules/prompt/infrastructure/static-agent-profile.provider";
import type { Conversation } from "../src/modules/conversation/domain/conversation.entity";
import type { HandleTurnCommand } from "../src/modules/conversation/application/handle-turn.use-case";

loadDotEnvIfPresent(join(__dirname, "..", ".env"));

const apiKey = process.env["ANTHROPIC_API_KEY"];
if (!apiKey) {
  console.error(
    "BLOCKED: ANTHROPIC_API_KEY is not set. This script evaluates REAL model behavior and " +
      "refuses to fabricate transcripts instead.",
  );
  process.exit(1);
}
const model = process.env["DEFAULT_LLM_MODEL"] ?? "claude-haiku-4-5";

const SYSTEM_PROMPT = assembleLayeredPrompt({
  platformBase: PLATFORM_BASE_PROMPT_V1,
  tenantDefault: DEFAULT_BRAND_VOICE_PROMPT,
  businessOverride: "",
  runtimeContext: "Business: All Phase Plumbing. Timezone: America/Chicago.",
});

interface ConversationScript {
  name: string;
  focus: string;
  turns: string[];
  enableTools?: boolean;
}

const SCRIPTS: ConversationScript[] = [
  {
    name: "A: normal conversation",
    focus:
      "Ordinary, calm exchange — mission's own acceptance bar: most sentences need NO delivery cue at all. A cue on every line here would itself be a failure (over-tagging).",
    turns: ["Hi, my kitchen faucet has a slow drip.", "It's been going on for about a week."],
  },
  {
    name: "B: frustrated customer",
    focus:
      "Caller is annoyed at being asked something twice. Expect a brief, sincere/warm acknowledgment (or no tag at all, just natural warmth) — never a canned apology, never robotic.",
    turns: [
      "My garbage disposal is jammed and it's making a horrible grinding noise.",
      "It's a General Electric, about eight years old.",
      "I already told you it's a GE, why are you asking again?",
    ],
  },
  {
    name: "C: emergency",
    focus:
      "Active flooding, real distress. Expect serious/calm/concerned-register delivery on the acknowledgment, not upbeat or casual — and escalateEmergency should still fire (regression, not new behavior).",
    turns: [
      "Oh my god, water is just pouring out from under my sink right now, it's flooding my kitchen, I don't know what to do.",
      "I already turned off the water at the wall but there's still water everywhere.",
    ],
    enableTools: true,
  },
  {
    name: "D: direct question",
    focus:
      "A plain factual question mid-flow. Expect a direct, confident answer — this is the 'ordinary question' register, not an emotionally loaded one.",
    turns: [
      "Hi, my bathroom sink is clogged and draining really slowly.",
      "Actually wait — are you guys open right now? It's pretty late.",
    ],
  },
  {
    name: "E: correction",
    focus:
      "Caller corrects a name mid-call. Expect a brief, natural acknowledgment of the correction (own it, don't over-apologize) — response SHAPE: one idea, not a re-explanation.",
    turns: [
      "Hi, my garbage disposal stopped working entirely.",
      "My name is John Smith.",
      "Actually, sorry, it's John Smythe, S-M-Y-T-H-E.",
    ],
  },
  {
    name: "I/J: long rambling answer, then a short one-word answer",
    focus:
      "Response SHAPE test either way: one acknowledgment + one next step, not a giant paragraph for the long answer, and not padding for the short one.",
    turns: [
      "So, okay, this has been going on for a while now, I think it started maybe two weeks ago, or maybe it was three, honestly I lose track, but basically the water heater makes this banging noise every single time anyone runs hot water anywhere in the house, and my spouse thinks it's going to explode, which is probably dramatic, but I don't know, it's worrying.",
      "Yeah.",
    ],
  },
  {
    name: "L/M: topic change and return",
    focus:
      "Caller interrupts their own problem description with an unrelated pricing question, then returns to it. Expect ordinary/curious register for the pricing tangent, then back to the original thread naturally — no restart, no stacked questions.",
    turns: [
      "Hi, my AC isn't cooling the house at all.",
      "Actually, before we get into that — how much do you typically charge just for a diagnostic visit?",
      "Okay that's helpful. So yeah, the AC — it's been blowing room-temperature air since this morning.",
    ],
  },
  {
    name: "N: objection",
    focus:
      "Caller pushes back / objects. Expect calm-confident register, not defensive or apologetic.",
    turns: [
      "Hi, my water heater is out.",
      "Honestly your prices sound high compared to another company I called — why should I go with you guys?",
    ],
  },
  {
    name: "O: customer asks Grace to repeat something",
    focus:
      "Caller asks Grace to repeat what she just said. Expect a natural, brief repeat/re-confirm — not a full re-explanation from scratch, not an apology-heavy response.",
    turns: [
      "Hi, my dishwasher is leaking onto the floor.",
      "Sorry, can you say that last part again? I didn't catch it.",
    ],
  },
];

const KNOWN_TAG_WORDS = new Set([
  "sincere",
  "warmly",
  "warm",
  "softly",
  "serious",
  "curious",
  "thoughtful",
  "confident",
  "frustrated",
  "tired",
  "gentle",
  "reassuring",
  "concerned",
  "relieved",
  "building",
  "slower",
  "calm",
  "sighs",
  "pause",
]);

function scanTags(text: string): { tags: string[]; unknown: string[] } {
  const tags: string[] = [];
  const unknown: string[] = [];
  const pattern = /\[([^[\]]{0,60})\]/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const body: string = (match[1] ?? "").trim();
    tags.push(body);
    const words: string[] = body
      .split(",")
      .map((w: string) => w.trim().toLowerCase())
      .filter((w: string) => w.length > 0);
    if (!words.some((w: string) => KNOWN_TAG_WORDS.has(w))) {
      unknown.push(body);
    }
  }
  return { tags, unknown };
}

async function runScript(script: ConversationScript): Promise<void> {
  const aiProvider = new AnthropicAdapter(apiKey, process.env["ANTHROPIC_BASE_URL"]);
  const repository = new FakeConversationRepository();
  const eventBus = new FakeEventBus();
  const idempotencyStore = new InMemoryIdempotencyStore();
  const toolRegistry = new ToolRegistry();
  const executeTool = new ExecuteToolUseCase(
    toolRegistry,
    new InMemoryIdempotencyStore(),
    new FakeToolAuditLog(),
    createNoopLogger(),
  );
  const allowedTools: string[] = [];
  if (script.enableTools) {
    for (const definition of TOOL_CATALOG) {
      const handler = new FakeToolHandler();
      handler.output = { id: randomUUID(), found: false, isEmergency: true };
      toolRegistry.register(definition, handler);
      allowedTools.push(definition.name);
    }
  }
  const useCase = new HandleTurnUseCase(
    repository,
    aiProvider,
    executeTool,
    toolRegistry,
    eventBus,
    idempotencyStore,
    createNoopLogger(),
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

  console.log(`\n########## ${script.name} ##########`);
  console.log(`Focus: ${script.focus}\n`);

  for (const callerText of script.turns) {
    const command: HandleTurnCommand = {
      tenantId: "measurement-tenant",
      conversationId,
      idempotencyKey: randomUUID(),
      transcript: callerText,
      allowedTools,
    };
    const result = await useCase.execute(command);
    const { tags, unknown } = scanTags(result.responseText);
    console.log(`Caller: ${callerText}`);
    console.log(`CSR:    ${result.responseText}`);
    console.log(
      `        [cues: ${tags.length === 0 ? "none" : tags.join(" | ")}]${
        unknown.length > 0
          ? `  [UNRECOGNIZED (would be silently stripped, no effect): ${unknown.join(", ")}]`
          : ""
      }`,
    );
    console.log("");
  }
}

async function main(): Promise<void> {
  console.log(`Model: ${model}`);
  for (const script of SCRIPTS) {
    await runScript(script);
  }
  console.log(
    "\n(Read each transcript above: does the cue, if any, match the emotional context? Are " +
      "most lines cue-free, per the prompt's own 'most sentences need no cue at all' " +
      "instruction? Is each response one idea, not a stacked list of questions? This script " +
      "prints real model output plus a mechanical tag scan for human judgment — it does not " +
      "auto-grade delivery quality.)",
  );
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
  console.error("Emotional-delivery measurement run failed:", error);
  process.exit(1);
});
