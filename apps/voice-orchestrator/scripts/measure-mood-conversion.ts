/**
 * Real-model audit: does Grace reliably reach a captured customer/lead
 * across a wide range of caller MOODS, not just the ones already
 * verified this mission (angry/hostile, frustrated-by-interruption)?
 * Each scenario is a distinct caller personality/emotional state that
 * could plausibly derail a qualifying conversation if Grace doesn't
 * adapt — the test is whether createCustomer/createLead still fires by
 * the end, and whether the tone along the way actually fits the mood.
 *
 * Moods NOT yet tested elsewhere this mission:
 *  A. Anxious/worried (scared of a big cost, over-explains out of nerves)
 *  B. Indecisive (flip-flops, "maybe I should just wait")
 *  C. Impatient/rushed (short answers, wants off the phone fast)
 *  D. Skeptical/distrustful ("how do I know this isn't a scam")
 *  E. Confused / needs things explained simply
 *  F. Rambling / goes on tangents, needs gentle redirection
 *  G. Price-shopping ("I'm calling a few places to compare")
 *  H. Sad/discouraged (not angry — just worn down by the situation)
 *  I. Minimal/monosyllabic (gives almost nothing back)
 *  J. Happy/excited (positive baseline — should be the easy case)
 *
 * Run: pnpm exec ts-node -T scripts/measure-mood-conversion.ts
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
import { TOOL_CATALOG } from "../src/modules/tool-broker/domain/tool-catalog";
import {
  assembleLayeredPrompt,
  PLATFORM_BASE_PROMPT_V1,
} from "../src/modules/prompt/domain/prompt-layers";
import { formatRuntimeContext } from "../src/modules/prompt/domain/runtime-context";
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

const NEW_CUSTOMER_UUID = randomUUID();

// Mirrors what assemble-system-prompt.use-case.ts actually puts in the
// RUNTIME CONTEXT layer on a real call — most importantly "Caller ANI:
// <number>", which the createCustomer tool description explicitly tells
// the model it may use as the phone number instead of asking for one.
// Building the runtimeContext as a hand-typed string without this (as an
// earlier version of this script did) silently starves the model of
// exactly the fact it needs to skip a redundant "what's your phone
// number?" — a gap in the TEST, not in production, and it would have
// been misread as a real conversion-rate bug.
function buildSystemPrompt(callerAni: string): string {
  const runtimeContext = formatRuntimeContext({
    currentTimeIso: new Date().toISOString(),
    timezone: "America/Chicago",
    businessHours: { isOpen: true, isHoliday: false },
    callerAni,
    existingCustomerMatch: null,
  });
  return assembleLayeredPrompt({
    platformBase: PLATFORM_BASE_PROMPT_V1,
    tenantDefault: DEFAULT_BRAND_VOICE_PROMPT,
    businessOverride: "",
    runtimeContext: `Business: All Phase Plumbing. ${runtimeContext}`,
  });
}

function buildConversation(callerAni: string): {
  conversation: Conversation;
  conversationId: string;
} {
  const conversationId = randomUUID();
  const conversation: Conversation = {
    id: conversationId,
    tenantId: "measurement-tenant",
    businessId: "measurement-business",
    callId: randomUUID(),
    state: "qualifying",
    systemPrompt: buildSystemPrompt(callerAni),
    llmModel: model,
    messages: [],
    transcript: [],
    leadId: null,
    startedAt: new Date().toISOString(),
    endedAt: null,
    capacityReservationId: "measurement-reservation",
    endReason: null,
    version: 1,
    callerAni,
  };
  return { conversation, conversationId };
}

function buildUseCase(repository: FakeConversationRepository): {
  useCase: HandleTurnUseCase;
  allowedTools: string[];
  getLeadPriority: () => string | null;
} {
  const aiProvider = new AnthropicAdapter(apiKey, process.env["ANTHROPIC_BASE_URL"]);
  const toolRegistry = new ToolRegistry();
  let leadPriority: string | null = null;
  for (const definition of TOOL_CATALOG) {
    if (definition.name === "createCustomer") {
      toolRegistry.register(definition, {
        execute: async () => ({ customer_id: NEW_CUSTOMER_UUID, created: true }),
      });
    } else if (definition.name === "createLead") {
      toolRegistry.register(definition, {
        execute: async (input: unknown) => {
          leadPriority = (input as { priority?: string }).priority ?? null;
          return { lead_id: randomUUID(), created: true };
        },
      });
    } else {
      toolRegistry.register(definition, {
        execute: async () => ({ id: randomUUID(), found: false, isEmergency: false }),
      });
    }
  }
  const executeTool = new ExecuteToolUseCase(
    toolRegistry,
    new InMemoryIdempotencyStore(),
    new FakeToolAuditLog(),
    createNoopLogger(),
  );
  const useCase = new HandleTurnUseCase(
    repository,
    aiProvider,
    executeTool,
    toolRegistry,
    new FakeEventBus(),
    new InMemoryIdempotencyStore(),
    createNoopLogger(),
  );
  const allowedTools = TOOL_CATALOG.map((t) => t.name);
  return { useCase, allowedTools, getLeadPriority: () => leadPriority };
}

async function runMoodScenario(label: string, callerAni: string, turns: string[]): Promise<void> {
  console.log(`\n########## ${label} ##########`);
  const repository = new FakeConversationRepository();
  const { conversation, conversationId } = buildConversation(callerAni);
  repository.seed(conversation);
  const { useCase, allowedTools, getLeadPriority } = buildUseCase(repository);

  for (const turn of turns) {
    const command: HandleTurnCommand = {
      tenantId: "measurement-tenant",
      conversationId,
      idempotencyKey: randomUUID(),
      transcript: turn,
      allowedTools,
    };
    const result = await useCase.execute(command);
    console.log(`Caller: ${turn}`);
    console.log(`CSR:    ${result.responseText}`);
    if (result.toolCallsExecuted.length > 0) {
      const mid = await repository.findById("measurement-tenant", conversationId);
      console.log(
        `        [tools: ${result.toolCallsExecuted.join(", ")}] (customerId=${mid?.customerId ?? "-"} leadId=${mid?.leadId ?? "-"})`,
      );
    }
  }
  const saved = await repository.findById("measurement-tenant", conversationId);
  console.log(
    `RESULT: customerId=${saved?.customerId ?? "NEVER CAPTURED"} leadId=${saved?.leadId ?? "NEVER CREATED"} priority=${getLeadPriority() ?? "n/a"}`,
  );
}

async function main(): Promise<void> {
  console.log(`Model: ${model}`);

  await runMoodScenario("A: Anxious/worried caller", "+15551000001", [
    "Um, hi, I'm really sorry to bother you, but I have this water stain on my ceiling and I'm kind of freaking out about it, is that going to be really expensive?",
    "Okay... my name is Pat Nguyen. I just don't want this to turn into some huge thing, you know?",
    "Yeah, okay, that makes me feel a little better. Go ahead and submit it I guess.",
  ]);

  await runMoodScenario("B: Indecisive caller", "+15551000002", [
    "Hi, so, my garbage disposal is broken, but I don't know, maybe I should just try to fix it myself first.",
    "Actually no, you know what, let's get someone to look at it. Wait, actually, how much would that cost roughly?",
    "Hmm, okay, I think... yeah let's do it. My name's Casey Lin.",
    "Actually wait, let me think about it. ...no okay, go ahead, submit it.",
  ]);

  await runMoodScenario("C: Impatient/rushed caller", "+15551000003", [
    "Hey, quick, my pipe's leaking, I gotta run in like two minutes.",
    "Sam Torres. Just get it done please.",
    "Yes submit it, gotta go, bye.",
  ]);

  await runMoodScenario("D: Skeptical/distrustful caller", "+15551000004", [
    "Hi, how do I know you're not just gonna scam me or upsell me on stuff I don't need? My water heater's making noise.",
    "Okay fine. Riley Adams. But I want a real person to call me, not some robot texting me spam.",
    "Fine, go ahead, submit it, but I better not get spammed.",
  ]);

  await runMoodScenario("E: Confused caller, needs things explained simply", "+15551000005", [
    "Hello? I don't really understand all this plumbing stuff, my sink is doing something weird.",
    "I'm not sure what you mean by that, can you explain it simpler?",
    "Oh okay I think I understand now. My name is Dorothy Mensah.",
    "Yes please, go ahead and get that set up for me.",
  ]);

  await runMoodScenario("F: Rambling caller, goes on tangents", "+15551000006", [
    "Hi so, okay, this is gonna sound weird but my neighbor actually recommended you guys, she had a great experience, anyway my kitchen faucet is dripping, and also my dog just had surgery so it's been a stressful week, but yeah the faucet, it drips like every few seconds.",
    "Oh sorry, yeah, my name is Morgan Yilmaz. Anyway like I was saying, the dog surgery was rough but she's doing okay now.",
    "Oh right, sorry, yes please submit it, thank you for listening to all that.",
  ]);

  await runMoodScenario("G: Price-shopping caller", "+15551000007", [
    "Hi, I'm calling around to a few plumbing companies to compare, my water heater died. What would you charge for that?",
    "Okay. What makes you guys different from the other places I'm calling?",
    "Alright, that's fair. My name's Jordan Kessler, go ahead and get me set up, I'll compare after.",
  ]);

  await runMoodScenario("H: Sad/discouraged caller", "+15551000008", [
    "Hi... honestly this house has just been one thing after another, now the toilet's leaking too.",
    "Yeah. It's just a lot. My name is Avery Solberg.",
    "Thanks for being nice about it. Yeah, go ahead and submit it.",
  ]);

  await runMoodScenario("I: Minimal/monosyllabic caller", "+15551000009", [
    "sink broken",
    "leaking",
    "kitchen",
    "Drew Park",
    "yes",
  ]);

  await runMoodScenario("J: Happy/excited caller (baseline)", "+15551000010", [
    "Hi there! So excited to finally get this fixed, my shower's been low pressure forever!",
    "It's great, thanks for asking! I'm Taylor Nakamura.",
    "Perfect, yes, let's do it, submit away!",
  ]);

  console.log(
    "\n(Read each transcript above and judge directly — check both TONE fit for the mood and whether a lead was actually captured.)",
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
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

main().catch((error: unknown) => {
  console.error("Mood-conversion measurement run failed:", error);
  process.exit(1);
});
