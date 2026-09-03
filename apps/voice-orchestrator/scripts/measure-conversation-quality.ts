/**
 * REAL-MODEL conversation-quality evidence — Phases 5/6/7 of the
 * voice-latency optimization pass (natural turn-taking, conversational
 * memory, name handling). These are fundamentally MODEL BEHAVIOR
 * questions ("does the model re-ask a question it already has the
 * answer to," "does it correctly split a spoken name") that a
 * deterministic e2e test with `FakeAiProvider` cannot evaluate — a fake
 * always returns pre-scripted text regardless of what the caller said,
 * so there is nothing for it to get right or wrong. This script runs
 * REAL multi-turn conversations against the REAL Anthropic API, using
 * the REAL platform-base system prompt (the exact text every live
 * conversation is assembled from — `PLATFORM_BASE_PROMPT_V1`, with an
 * empty tenant/business override layer, i.e. the platform's own
 * baseline behavior with no tenant customization), and prints the full
 * transcript for direct inspection — real evidence, not an assumption
 * that "the prompt says X" means the model reliably does X.
 *
 * Run: pnpm exec ts-node -T scripts/measure-conversation-quality.ts
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
import {
  assembleLayeredPrompt,
  PLATFORM_BASE_PROMPT_V1,
} from "../src/modules/prompt/domain/prompt-layers";
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
  tenantDefault: "",
  businessOverride: "",
  runtimeContext: "Business: All Phase Plumbing. Timezone: America/Chicago.",
});

interface ConversationScript {
  name: string;
  focus: string;
  turns: string[];
}

const SCRIPTS: ConversationScript[] = [
  {
    name: "Name handling",
    focus:
      "Phase 7: a single word should prompt for a last name; two words together should be accepted as first+last without re-asking.",
    turns: [
      "Hi, my kitchen sink is leaking under the cabinet.",
      "Akash",
      // Expect the model to ask for a last name here, NOT re-ask for the first name.
      "Kumar",
    ],
  },
  {
    name: "Name handling — given together",
    focus:
      "Phase 7: 'Akash Kumar' (or 'My name is Akash Kumar') in one utterance should be accepted as first+last WITHOUT a follow-up asking for a last name.",
    turns: ["Hi, my water heater stopped working.", "My name is Akash Kumar."],
  },
  {
    name: "Natural turn-taking / backchannel",
    focus:
      "Phase 5: short answers, corrections, and a topic add-on should never be treated as if the caller said nothing substantive, and the model should never re-ask something already answered.",
    turns: [
      "My AC stopped cooling yesterday.",
      "Yeah.",
      "Well, it's blowing warm air, but actually, wait — it's not blowing any air at all now.",
      "Right.",
      "Actually before that, do you guys serve the 75201 zip code?",
    ],
  },
  {
    name: "Conversational memory / no re-asking",
    focus:
      "Phase 6: name, phone, and issue given across separate turns should all be remembered — none should be asked for twice.",
    turns: [
      "Hi, this is Jordan Ellis calling.",
      "My number is 555-201-4477.",
      "My garbage disposal is jammed and making a loud noise.",
      "It started this morning.",
      "No, sorry, I mean it started yesterday morning, not this morning.",
    ],
  },
];

async function runScript(script: ConversationScript): Promise<void> {
  const aiProvider = new AnthropicAdapter(apiKey!, process.env["ANTHROPIC_BASE_URL"]);
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
      allowedTools: [],
    };
    const result = await useCase.execute(command);
    console.log(`Caller: ${callerText}`);
    console.log(`CSR:    ${result.responseText}\n`);
  }
}

async function main(): Promise<void> {
  console.log(`Model: ${model}`);
  for (const script of SCRIPTS) {
    await runScript(script);
  }
  console.log(
    "\n(Read each transcript above and judge against its stated focus — this script prints " +
      "real model output for human/manual inspection, it does not auto-grade conversation quality.)",
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
  console.error("Conversation-quality run failed:", error);
  process.exit(1);
});
