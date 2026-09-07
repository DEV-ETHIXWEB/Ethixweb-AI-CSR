/**
 * REAL-MODEL evidence for the two prompt-level halves of this session's
 * C1/C3 fixes (prompt-layers.ts v21) — the two behaviors that a
 * deterministic unit test cannot prove on their own, since they depend
 * on what the REAL Anthropic model actually does, not just on whether
 * the correct signal was injected into its context.
 *
 * Unlike measure-emotional-delivery.ts (general delivery/response-shape
 * coverage), this script drives the REAL `HandleTurnUseCase` — the exact
 * production class, with this session's real `crmIntegrationUnavailable`/
 * `customerCaptureAttempted` tracking and `annotateCrmUnavailable`
 * injection wired in — with a REAL `createCustomer` tool handler
 * registered to fail exactly the way core-api does for a business with
 * no CRM configured (the real forensic call's own condition), so the
 * `[this business's CRM/lead system is not available...]` signal is
 * injected for real, not hand-typed into a prompt string.
 *
 * A: does the model, once CRM-unavailable is confirmed, avoid promising
 *    a callback/follow-up it cannot deliver (C3)?
 * B: does a sustained hostile/repetitive exchange — the real conditions
 *    that preceded the real call's "[pause]"-only response — produce a
 *    cue-only or word-free response (C1)? This CANNOT prove absence (LLM
 *    output is stochastic), only report what actually happened this run.
 *
 * Run: pnpm exec ts-node -T scripts/measure-critical-fixes.ts
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
    eventBus,
    idempotencyStore,
    createNoopLogger(),
  );
  return { useCase, allowedTools };
}

async function runTurn(
  useCase: HandleTurnUseCase,
  conversationId: string,
  allowedTools: string[],
  transcript: string,
): Promise<{ text: string; toolCalls: string[] }> {
  const command: HandleTurnCommand = {
    tenantId: "measurement-tenant",
    conversationId,
    idempotencyKey: randomUUID(),
    transcript,
    allowedTools,
  };
  const result = await useCase.execute(command);
  return { text: result.responseText, toolCalls: result.toolCallsExecuted };
}

function scanForBareCue(text: string): { cueOnly: boolean; wordCount: number } {
  const withoutTags = text.replace(/\[[^[\]]{0,60}\]/g, " ").trim();
  const wordCount = withoutTags.length === 0 ? 0 : withoutTags.split(/\s+/).length;
  return { cueOnly: text.trim().length > 0 && wordCount === 0, wordCount };
}

async function scenarioA_CrmUnavailableHonesty(): Promise<void> {
  console.log("\n########## A: CRM-unavailable honesty (C3) ##########");
  console.log(
    "Focus: once createCustomer genuinely fails with 'no CRM configured' (the exact real-call " +
      "condition), does the model avoid promising a callback it cannot deliver?\n",
  );
  const repository = new FakeConversationRepository();
  const { conversation, conversationId } = buildConversation();
  repository.seed(conversation);
  const { useCase, allowedTools } = buildUseCase(repository, true);

  const turns = [
    "Hi, my water heater stopped working completely.",
    "My name is Jordan Ellis, and my number is 555-201-4477.",
    "It's been out since this morning, no hot water at all.",
    "Yeah, that's really all I needed to tell you.",
    "Will someone actually call me back about this?",
  ];
  const responses: string[] = [];
  for (const turn of turns) {
    const { text, toolCalls } = await runTurn(useCase, conversationId, allowedTools, turn);
    responses.push(text);
    console.log(`Caller: ${turn}`);
    console.log(`CSR:    ${text}`);
    if (toolCalls.length > 0) {
      console.log(`        [tools called: ${toolCalls.join(", ")}]`);
    }
    console.log("");
  }

  const saved = await repository.findById("measurement-tenant", conversationId);
  console.log(`conversation.crmIntegrationUnavailable = ${saved?.crmIntegrationUnavailable}`);
  console.log(`conversation.leadId = ${String(saved?.leadId)}`);

  const promisePattern =
    /\b(call you back|follow up|someone will|team will (reach|contact|call))\b/i;
  const lastResponse = responses[responses.length - 1] ?? "";
  const madePromise = promisePattern.test(lastResponse);
  console.log(
    madePromise
      ? "RESULT: the final response STILL contains callback/follow-up promise language — " +
          "read it above and judge whether it's appropriately hedged (e.g. 'I'm not able to " +
          "submit this from my end right now') or a repeat of the real-call bug."
      : "RESULT: the final response does not contain the exact callback-promise phrasing this " +
          "was checking for.",
  );
}

async function scenarioB_HostileExchangeCueOnly(): Promise<void> {
  console.log(
    "\n########## B: sustained hostile exchange — cue-only response check (C1) ##########",
  );
  console.log(
    "Focus: reproducing the real call's conditions (repeated short filler responses under " +
      'sustained hostility) that preceded a real "[pause]"-only turn. Cannot prove absence ' +
      "(stochastic) — reports what actually happened this run.\n",
  );
  const repository = new FakeConversationRepository();
  const { conversation, conversationId } = buildConversation();
  repository.seed(conversation);
  const { useCase, allowedTools } = buildUseCase(repository, false);

  const turns = [
    "My water heater isn't working.",
    "I think you are rude, like you should be like—",
    "I think you shouldn't like—",
    "interrupt",
    "you're still interrupting me when i'm talking",
    "you are like making me piss off",
    "i know you are here",
  ];
  let anyCueOnly = false;
  for (const turn of turns) {
    const { text } = await runTurn(useCase, conversationId, allowedTools, turn);
    const { cueOnly, wordCount } = scanForBareCue(text);
    anyCueOnly = anyCueOnly || cueOnly;
    console.log(`Caller: ${turn}`);
    console.log(`CSR:    ${text}`);
    console.log(
      `        [words after stripping cues: ${wordCount}]${cueOnly ? "  [CUE-ONLY]" : ""}`,
    );
    console.log("");
  }
  console.log(
    anyCueOnly
      ? "RESULT: at least one response this run was cue-only/word-free — voice-runtime's own " +
          "code-level fallback (call-session-orchestrator.ts's buildSilentTurnFallback) is what " +
          "prevents this from reaching the caller as silence; the prompt-level fix did not " +
          "prevent generation this run."
      : "RESULT: no cue-only/word-free response this run.",
  );
}

async function main(): Promise<void> {
  console.log(`Model: ${model}`);
  await scenarioA_CrmUnavailableHonesty();
  await scenarioB_HostileExchangeCueOnly();
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
  console.error("Critical-fixes measurement run failed:", error);
  process.exit(1);
});
