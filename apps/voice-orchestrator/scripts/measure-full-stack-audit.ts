/**
 * Comprehensive real-model audit script — driven by the user's explicit
 * "test everything from start to end, no assumptions" request. Covers
 * ground NOT yet exercised by this mission's other measurement scripts:
 *
 *  A. Full happy path to a SUCCESSFUL createLead (searchCustomer finds
 *     nothing -> createCustomer succeeds -> createLead succeeds) —
 *     never actually verified end-to-end against the real model before;
 *     every prior script either stubbed createCustomer to fail (CRM
 *     unavailable) or stopped short of createLead.
 *  B. Repeat caller — searchCustomer finds an EXISTING match, confirms
 *     the model uses it instead of re-collecting from scratch, and
 *     calls lookupPreviousCalls.
 *  C. getServiceAreas / getBusinessHours (H2) — durable outcome tracking
 *     re-verified against a real model turn, not just unit tests.
 *  D. A long (18+ turn) conversation that crosses DEFAULT_MAX_MESSAGES,
 *     forcing REAL compressMessages compaction, then asks the caller's
 *     name back near the end — the exact real-call bug class
 *     context-window.ts's own comment documents.
 *  E. Emergency -> forward_call -> createLead priority="emergency" flow,
 *     checked end-to-end (not just that escalateEmergency was called).
 *
 * Run: pnpm exec ts-node -T scripts/measure-full-stack-audit.ts
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

/**
 * FOUND LIVE running this exact script: a first version used
 * human-readable fake customer_id strings ("cust-new-77") — real core-api
 * always returns a genuine UUID, but createLead's own schema (tool-catalog.ts)
 * requires one too, so a non-UUID fake customer_id got the createLead call
 * VALIDATION-REJECTED, purely a test-fidelity bug in this harness, not a
 * production one. Real UUIDs here so the signal from this script reflects
 * what a real call actually experiences.
 */
const EXISTING_CUSTOMER_UUID = randomUUID();
const NEW_CUSTOMER_UUID = randomUUID();

const SYSTEM_PROMPT = assembleLayeredPrompt({
  platformBase: PLATFORM_BASE_PROMPT_V1,
  tenantDefault: DEFAULT_BRAND_VOICE_PROMPT,
  businessOverride: "",
  runtimeContext: "Business: All Phase Plumbing. Timezone: America/Chicago.",
});

function buildConversation(callerAni: string | null): {
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
    ...(callerAni ? { callerAni } : {}),
  };
  return { conversation, conversationId };
}

interface ToolHandlerOverrides {
  searchCustomerFound?: boolean;
  serviceAreaResult?: boolean;
}

function buildUseCase(
  repository: FakeConversationRepository,
  overrides: ToolHandlerOverrides = {},
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
    if (definition.name === "searchCustomer") {
      toolRegistry.register(definition, {
        execute: async () =>
          overrides.searchCustomerFound
            ? {
                found: true,
                customer_id: EXISTING_CUSTOMER_UUID,
                name: { first: "Morgan", last: "Reyes" },
                address: { street: "12 Elm St", city: "Chicago", state: "IL", zip: "60601" },
              }
            : { found: false },
      });
    } else if (definition.name === "createCustomer") {
      toolRegistry.register(definition, {
        execute: async () => ({ customer_id: NEW_CUSTOMER_UUID, created: true }),
      });
    } else if (definition.name === "createLead") {
      toolRegistry.register(definition, {
        execute: async () => ({ lead_id: "lead-99", created: true }),
      });
    } else if (definition.name === "getServiceAreas") {
      toolRegistry.register(definition, {
        execute: async () => ({ inServiceArea: overrides.serviceAreaResult ?? true }),
      });
    } else if (definition.name === "getBusinessHours") {
      toolRegistry.register(definition, {
        execute: async () => ({ isOpen: true, isHoliday: false }),
      });
    } else if (definition.name === "lookupPreviousCalls") {
      toolRegistry.register(definition, {
        execute: async () => ({
          calls: [{ summary: "Garbage disposal repaired 3 months ago", date: "2026-06-01" }],
        }),
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

async function sendTurn(
  useCase: HandleTurnUseCase,
  conversationId: string,
  allowedTools: string[],
  transcript: string,
  log = true,
): Promise<{ text: string; toolCalls: string[]; escalation: unknown }> {
  const command: HandleTurnCommand = {
    tenantId: "measurement-tenant",
    conversationId,
    idempotencyKey: randomUUID(),
    transcript,
    allowedTools,
  };
  const result = await useCase.execute(command);
  if (log) {
    console.log(`Caller: ${transcript}`);
    console.log(`CSR:    ${result.responseText}`);
    if (result.toolCallsExecuted.length > 0) {
      console.log(`        [tools: ${result.toolCallsExecuted.join(", ")}]`);
    }
    if (result.escalation) {
      console.log(`        [escalation: ${JSON.stringify(result.escalation)}]`);
    }
  }
  return {
    text: result.responseText,
    toolCalls: result.toolCallsExecuted,
    escalation: result.escalation,
  };
}

async function scenarioA_FullHappyPathToLead(): Promise<void> {
  console.log("\n########## A: full happy path to a SUCCESSFUL createLead ##########");
  const repository = new FakeConversationRepository();
  const { conversation, conversationId } = buildConversation("+15552014477");
  repository.seed(conversation);
  const { useCase, allowedTools } = buildUseCase(repository);

  await sendTurn(useCase, conversationId, allowedTools, "Hi, my garbage disposal stopped working.");
  await sendTurn(useCase, conversationId, allowedTools, "My name is Taylor Brooks.");
  await sendTurn(
    useCase,
    conversationId,
    allowedTools,
    "It just hums but doesn't spin, been like that for two days.",
  );
  await sendTurn(
    useCase,
    conversationId,
    allowedTools,
    "That's everything, please go ahead and submit it.",
  );

  const saved = await repository.findById("measurement-tenant", conversationId);
  console.log(
    `RESULT: customerId=${saved?.customerId ?? "null"} leadId=${saved?.leadId ?? "null"} customerCaptureAttempted=${saved?.customerCaptureAttempted} leadEverAttempted=${saved?.leadEverAttempted}`,
  );
}

async function scenarioB_RepeatCaller(): Promise<void> {
  console.log("\n########## B: repeat caller — searchCustomer finds an existing match ##########");
  const repository = new FakeConversationRepository();
  const { conversation, conversationId } = buildConversation("+15559871234");
  repository.seed(conversation);
  const { useCase, allowedTools } = buildUseCase(repository, { searchCustomerFound: true });

  await sendTurn(
    useCase,
    conversationId,
    allowedTools,
    "Hi, it's Morgan again, my kitchen sink is clogged now.",
  );
  await sendTurn(useCase, conversationId, allowedTools, "Yeah that's still the right address.");
}

async function scenarioC_ServiceAreaAndBusinessHours(): Promise<void> {
  console.log("\n########## C: getServiceAreas / getBusinessHours (H2) ##########");
  const repository = new FakeConversationRepository();
  const { conversation, conversationId } = buildConversation("+15551112222");
  repository.seed(conversation);
  const { useCase, allowedTools } = buildUseCase(repository, { serviceAreaResult: false });

  await sendTurn(useCase, conversationId, allowedTools, "Hi, do you guys service zip code 90210?");
  await sendTurn(useCase, conversationId, allowedTools, "Oh okay. Are you open right now?");
  const saved = await repository.findById("measurement-tenant", conversationId);
  console.log(
    `RESULT: serviceAreaChecked=${saved?.serviceAreaChecked} lastServiceAreaCheck=${JSON.stringify(saved?.lastServiceAreaCheck)} businessHoursChecked=${saved?.businessHoursChecked}`,
  );
}

async function scenarioD_LongConversationCompaction(): Promise<void> {
  console.log(
    "\n########## D: long conversation crossing real compaction, name still recalled ##########",
  );
  const repository = new FakeConversationRepository();
  const { conversation, conversationId } = buildConversation("+15553334444");
  repository.seed(conversation);
  const { useCase, allowedTools } = buildUseCase(repository);

  await sendTurn(
    useCase,
    conversationId,
    allowedTools,
    "Hi, this is Alexandra Whitfield-Montgomery calling.",
    false,
  );
  console.log("Caller: Hi, this is Alexandra Whitfield-Montgomery calling.");
  const filler = [
    "My water heater is old and I've been thinking about replacing it.",
    "It's a gas unit, about twelve years old.",
    "It still works but it's slow to heat up now.",
    "I noticed some rust around the base of it too.",
    "It's in the basement, in a small utility closet.",
    "There's also a sump pump nearby that runs a lot.",
    "The basement gets a little damp sometimes.",
    "I've had a plumber out before for a different issue.",
    "That was maybe two years ago, for a different house though.",
    "Anyway, I just want to know roughly what's involved in replacing it.",
    "Would it be a tank or tankless replacement typically?",
    "How long does that kind of job usually take?",
    "Do you need to shut off water to the whole house?",
    "Okay that makes sense.",
    "What about permits, do you handle that?",
    "Good to know.",
    "Alright, well, that's most of my questions.",
  ];
  for (const turn of filler) {
    await sendTurn(useCase, conversationId, allowedTools, turn, false);
  }
  const beforeAsk = await repository.findById("measurement-tenant", conversationId);
  console.log(`(messages array length before final ask: ${beforeAsk?.messages.length ?? -1})`);
  const final = await sendTurn(
    useCase,
    conversationId,
    allowedTools,
    "Sorry, can you remind me what name you have on file for me?",
  );
  const nameRecalled = final.text.toLowerCase().includes("alexandra");
  console.log(`RESULT: name correctly recalled after compaction = ${nameRecalled}`);
}

async function scenarioE_EmergencyToLeadPriority(): Promise<void> {
  console.log("\n########## E: emergency -> forward_call -> createLead priority flow ##########");
  const repository = new FakeConversationRepository();
  const { conversation, conversationId } = buildConversation("+15556667777");
  repository.seed(conversation);
  const aiProvider = new AnthropicAdapter(apiKey, process.env["ANTHROPIC_BASE_URL"]);
  const toolRegistry = new ToolRegistry();
  let createLeadPriority: string | null = null;
  for (const definition of TOOL_CATALOG) {
    if (definition.name === "escalateEmergency") {
      toolRegistry.register(definition, {
        execute: async () => ({
          isEmergency: true,
          severity: "critical",
          action: "forward_call",
          transferDestination: "+15550001111",
        }),
      });
    } else if (definition.name === "createCustomer") {
      toolRegistry.register(definition, {
        execute: async () => ({ customer_id: NEW_CUSTOMER_UUID, created: true }),
      });
    } else if (definition.name === "createLead") {
      toolRegistry.register(definition, {
        execute: async (input: unknown) => {
          createLeadPriority = (input as { priority?: string }).priority ?? null;
          return { lead_id: "lead-e", created: true };
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

  await sendTurn(
    useCase,
    conversationId,
    allowedTools,
    "There's a gas smell coming from my water heater right now!",
  );
  await sendTurn(
    useCase,
    conversationId,
    allowedTools,
    "My name is Jamie Chen, please get someone out here.",
  );
  await sendTurn(useCase, conversationId, allowedTools, "That's everything, please submit it now.");
  console.log(`RESULT: createLead priority field = ${createLeadPriority ?? "NEVER CALLED"}`);
}

async function main(): Promise<void> {
  console.log(`Model: ${model}`);
  await scenarioA_FullHappyPathToLead();
  await scenarioB_RepeatCaller();
  await scenarioC_ServiceAreaAndBusinessHours();
  await scenarioD_LongConversationCompaction();
  await scenarioE_EmergencyToLeadPriority();
  console.log("\n(Read each transcript above and judge directly.)");
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
  console.error("Full-stack audit measurement run failed:", error);
  process.exit(1);
});
