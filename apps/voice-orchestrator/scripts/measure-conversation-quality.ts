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

// tenantDefault uses the REAL default (not an empty string) — this is
// exactly what both StaticAgentProfileProvider and HttpAgentProfileProvider
// actually return in production (see that constant's own comment on why
// a personal name lives at this layer, not the platform base), so
// "does Grace actually introduce herself" is measured against the real
// assembled prompt, not a stripped-down approximation of it.
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
  /**
   * Off by default (`allowedTools: []`) to isolate pure conversational
   * flow from tool-calling complexity for the simpler scripts. When
   * true, every catalog tool is registered with a FakeToolHandler that
   * always succeeds and offered to the model — needed for scripts
   * where "can the model actually finish the call" is part of what's
   * being evaluated (a model with no tools available has no way to
   * complete a qualifying flow at all, which can itself distort
   * behavior — see v13's own comment on why this flag exists).
   */
  enableTools?: boolean;
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
  {
    name: "v12: property-manager call (real CSR-training reference material)",
    focus:
      "Let the caller explain before logistics questions; paraphrase back instead of a bare 'Okay'; ask who the real point of contact is (a tenant here) rather than assuming it's the caller; recognize the second/third issues mentioned in passing as real opportunities to help; describe a look-and-quote agreement honestly as not-yet-committed work; note the future remodel without pressuring; and — the one thing that must NOT appear — no specific appointment window offered (this platform has no scheduling integration to back that up).",
    turns: [
      "Hi, my name is Lisa Underwood. You guys have done some work for us on a rental property in Newcastle and I'm looking to get another plumbing issue looked at.",
      "The tenant has a washer and dryer that when the washer starts dumping its water like it's supposed to, ends up overflowing. So we think the drain's possibly clogged.",
      "It'll need to be coordinated with the tenants.",
      "I need to coordinate it with their schedule.",
      // Matches the real reference transcript's own order: Lisa gives HER
      // number as soon as it's asked for, directly, on the first ask —
      // this scenario is about whether the model behaves naturally when
      // the caller IS cooperative, distinct from the deliberately
      // adversarial "never answers" variant further below.
      "703-338-2044.",
      "We'd also like to consider adding a small utility sink, and we've got two outside faucets that are leaking.",
      "Yeah, that sounds good.",
      "Her name is Susan Holton, and her number is 206-276-7266.",
      "We'll want to pay for it ourselves, not have the tenant pay for it.",
      "We're also thinking about a kitchen remodel, possibly repiping, but that probably won't be solidified until January.",
      "Yes, that all sounds good, thank you.",
    ],
    enableTools: true,
  },
  {
    name: "v13: caller repeatedly does not answer a direct question (adversarial)",
    focus:
      "The harder case v12's own run surfaced: what happens when the caller keeps NOT answering a specific direct question (here, their own phone number), turning to other topics instead, all the way to a clear close signal. Should ask at most twice, then let it go rather than blocking the close on one field.",
    turns: [
      "Hi, my water heater stopped working completely, no hot water at all.",
      "It's been like this since yesterday.",
      "We'd also like someone to look at a slow drain in the kitchen while they're out.",
      "Yeah, whenever works.",
      "We'll cover the cost ourselves.",
      "Actually, we're also thinking about redoing the upstairs bathroom sometime next year.",
      "Yes, that's everything, thanks.",
    ],
    enableTools: true,
  },
  {
    name: "v14: name introduction, playful personal question, uncertain technical question",
    focus:
      "The greeting should introduce Grace by name (checked separately below, not in this scripted turn list). A playful 'how old are you' should get a warm deflection, never a fabricated fake age. A technical question the model can't confidently answer should defer to the technician, not guess.",
    turns: [
      "Hi, my kitchen faucet has been dripping for a few days.",
      "Ha, so how old are you anyway?",
      "If the plumber replaces the cartridge, will that definitely fix a slow drain in the same sink too, or could it be something else?",
    ],
  },
];

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
      handler.output = { id: randomUUID(), found: false, isEmergency: false };
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
    console.log(`Caller: ${callerText}`);
    console.log(`CSR:    ${result.responseText}`);
    if (result.toolCallsExecuted.length > 0) {
      console.log(`        [tools called: ${result.toolCallsExecuted.join(", ")}]`);
    }
    console.log("");
  }
}

/**
 * Replicates StartConversationUseCase.generateGreeting exactly (same
 * kickoff message, same "no tool calls" shape) without needing that
 * use case's full dependency graph (core-api client, capacity config,
 * etc.) — the ONLY thing being measured here is whether the model
 * actually introduces itself by name, which lives entirely in the
 * system prompt + this one kickoff message.
 */
async function checkGreeting(): Promise<void> {
  const aiProvider = new AnthropicAdapter(apiKey, process.env["ANTHROPIC_BASE_URL"]);
  const stream = aiProvider.streamCompletion({
    model,
    systemPrompt: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content:
          "[The call has just connected. Greet the caller now, following your instructions.]",
      },
    ],
  });
  let greeting = "";
  for await (const chunk of stream) {
    if (chunk.type === "text_delta") {
      greeting += chunk.text;
    }
  }
  console.log("\n########## v14: opening greeting ##########");
  console.log(
    "Focus: should introduce Grace by name, not a generic 'Thanks for calling' with no name.\n",
  );
  console.log(`Greeting: ${greeting}\n`);
}

async function main(): Promise<void> {
  console.log(`Model: ${model}`);
  await checkGreeting();
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
