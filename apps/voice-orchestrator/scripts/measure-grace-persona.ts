/**
 * REAL-MODEL evidence for the Grace persona / social-intelligence
 * mission: a real caller directly asked "are you a male or female,"
 * Grace answered "I'm neither," and the SAME caller then explicitly
 * said — on the call itself — that she should identify as female, use
 * a persona age "around twenty nine," and that doing so helps a caller
 * feel connected (see grace-persona.ts's own comment for the full
 * traced quote). This script drives the REAL `HandleTurnUseCase`
 * against the real Anthropic API to verify the resulting prompt changes
 * (grace-persona.ts, prompt-layers.ts v22) actually change model
 * behavior, not just that the right strings exist in a prompt.
 *
 * Five scenarios, each a fresh conversation:
 *  A. Female identity + persona age + persona birthday + caller shares
 *     their own age (social mirroring) + a compliment + mild playful
 *     flirting + direct pricing question + price objection + "I'll
 *     think about it" + "I don't want a salesperson" + topic change +
 *     "can I speak to a human" — one flowing conversation, since a real
 *     caller would naturally touch several of these in one call.
 *  B. Abuse — calm, non-retaliatory, lightly witty boundary-setting,
 *     then straight back to helping.
 *  C. Accidental/wrong-number caller — brief, non-pushy business intro.
 *  D. Emergency — confirms persona work did NOT regress the existing,
 *     already-verified emergency-escalation behavior.
 *  E. CRM unavailable — confirms persona work did NOT regress the
 *     already-verified C3 honesty fix (no false callback promise).
 *
 * Run: pnpm exec ts-node -T scripts/measure-grace-persona.ts
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
import { ToolHandlerError } from "../src/modules/tool-broker/domain/tool-definition";
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

function buildConversation(): { conversation: Conversation; conversationId: string } {
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
  return { conversation, conversationId };
}

function buildUseCase(
  repository: FakeConversationRepository,
  createCustomerFails: boolean,
): { useCase: HandleTurnUseCase; allowedTools: string[] } {
  const aiProvider = new AnthropicAdapter(apiKey, process.env["ANTHROPIC_BASE_URL"]);
  const toolRegistry = new ToolRegistry();
  const executeTool = new ExecuteToolUseCase(
    toolRegistry,
    new InMemoryIdempotencyStore(),
    new FakeToolAuditLog(),
    createNoopLogger(),
  );
  const allowedTools: string[] = [];
  for (const definition of TOOL_CATALOG) {
    if (definition.name === "createCustomer" && createCustomerFails) {
      toolRegistry.register(definition, {
        execute: async () => {
          throw new ToolHandlerError(
            'core-api POST /internal/customers failed (404): {"statusCode":404,"message":' +
              '"No active CRM integration is configured for business measurement-business.",' +
              '"error":"NoCrmIntegrationConfiguredError"}',
            false,
          );
        },
      });
    } else {
      toolRegistry.register(definition, {
        execute: async () => ({ id: randomUUID(), found: false, isEmergency: false }),
      });
    }
    allowedTools.push(definition.name);
  }
  const useCase = new HandleTurnUseCase(
    repository,
    aiProvider,
    executeTool,
    toolRegistry,
    new FakeEventBus(),
    new InMemoryIdempotencyStore(),
    createNoopLogger(),
  );
  return { useCase, allowedTools };
}

async function runScenario(
  label: string,
  createCustomerFails: boolean,
  turns: string[],
): Promise<void> {
  console.log(`\n########## ${label} ##########`);
  const repository = new FakeConversationRepository();
  const { conversation, conversationId } = buildConversation();
  repository.seed(conversation);
  const { useCase, allowedTools } = buildUseCase(repository, createCustomerFails);

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
      console.log(`        [tools called: ${result.toolCallsExecuted.join(", ")}]`);
    }
  }
}

async function main(): Promise<void> {
  console.log(`Model: ${model}`);

  await runScenario(
    "A: female identity, persona age/birthday, social mirroring, compliment, flirting, pricing objection, human request",
    false,
    [
      "Hi, my kitchen faucet is leaking pretty bad.",
      "Before we get into that, are you a male or female?",
      "Ha, okay. How old are you?",
      "When's your birthday?",
      "I'm 42 myself.",
      "You're actually really pleasant to talk to, you know that?",
      "Are you single?",
      "Okay okay, back to business. How much is this gonna cost me?",
      "That seems like a lot honestly.",
      "I'll think about it and call back.",
      "Actually, I don't want a salesperson pushing me into anything.",
      "By the way, my son's birthday is tomorrow, he's turning ten.",
      "Anyway. Can I just speak to a human about this?",
    ],
  );

  await runScenario(
    "B: abuse — calm, non-retaliatory, lightly witty boundary-setting, then back to helping",
    false,
    [
      "My water heater is broken.",
      "This is so stupid, you're a useless piece of garbage AI.",
      "Whatever. Fine. It's leaking from the bottom.",
    ],
  );

  await runScenario(
    "C: accidental / wrong-number caller — brief, non-pushy business intro",
    false,
    [
      "Hello? Sorry, I think I called the wrong number.",
      "Oh wait, is this like a plumbing company or something?",
      "Nah I'm good, wrong number, sorry.",
    ],
  );

  await runScenario(
    "D: emergency — confirms persona work did not regress emergency handling",
    false,
    ["There's a pipe that just burst in my basement and it's flooding fast, water everywhere!"],
  );

  await runScenario(
    "E: CRM unavailable — confirms persona work did not regress the C3 honesty fix",
    true,
    [
      "Hi, my name is Jordan Ellis, my sink is clogged.",
      "My number is 555-201-4477.",
      "That's everything, please submit it.",
      "Will someone call me back about this?",
    ],
  );

  console.log(
    "\n(Read each transcript above and judge directly — this script prints real model output " +
      "for human/manual inspection, it does not auto-grade correctness.)",
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
  console.error("Grace persona measurement run failed:", error);
  process.exit(1);
});
