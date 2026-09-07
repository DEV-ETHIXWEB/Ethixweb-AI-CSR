/**
 * REAL-MODEL evidence for M1: a real forensic call showed the model
 * calling `createCustomer` with `name` as a bare string ("Akash") instead
 * of the required `{first, last}` object, and separately omitting `phone`
 * entirely despite a valid Caller ANI being present the whole call. The
 * mission's own instruction was explicit: do NOT weaken the schema to
 * work around this — CreateCustomerInputSchema (tool-catalog.ts) still
 * rejects a string `name` exactly as before (see tool-catalog.spec.ts's
 * own M1 guardrail test). The actual fix added per-field `description`s
 * to the tool's own jsonSchema for `name`/`phone` — the most local signal
 * the model reads at the moment it constructs the call, previously blank
 * for exactly those two fields while `address` already had one (see
 * tool-catalog.ts's own comment). This script is the only way to verify
 * that fix actually changes real model behavior, not just that the
 * schema/description text exists.
 *
 * Drives the REAL `HandleTurnUseCase` — the exact production class —
 * against the real Anthropic API, with a real `createCustomer` tool
 * handler that RECORDS whatever arguments the model actually sent
 * (rather than validating/rejecting them itself), so a lingering shape
 * bug is visible directly instead of being silently caught and retried
 * by ExecuteToolUseCase's own schema check.
 *
 * 10 scenarios, covering the real call's own conditions plus the
 * adjacent cases a narrow fix could plausibly miss:
 *  1. Full name in one breath, ANI present, caller never states a phone.
 *  2. First name only, then last name given later, in a separate turn.
 *  3. Caller explicitly gives a DIFFERENT phone number than their ANI.
 *  4. ANI present, caller volunteers nothing about phone at all, ever.
 *  5. A hyphenated / multi-word last name.
 *  6. Caller states name AND address together, in one long turn.
 *  7. Caller corrects a misheard name mid-call, before createCustomer fires.
 *  8. No ANI at all (blocked/unavailable) — caller must give a number.
 *  9. Caller gives just one name word — model should ask for the last
 *     name rather than guessing or sending an incomplete object.
 * 10. Caller states name across a fragmented, multi-turn exchange.
 *
 * Run: pnpm exec ts-node -T scripts/measure-create-customer-args.ts
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

const SYSTEM_PROMPT = assembleLayeredPrompt({
  platformBase: PLATFORM_BASE_PROMPT_V1,
  tenantDefault: DEFAULT_BRAND_VOICE_PROMPT,
  businessOverride: "",
  runtimeContext: "Business: All Phase Plumbing. Timezone: America/Chicago.",
});

interface CapturedCall {
  arguments: Record<string, unknown>;
}

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

function buildUseCase(
  repository: FakeConversationRepository,
  captured: CapturedCall[],
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
    if (definition.name === "createCustomer") {
      toolRegistry.register(definition, {
        execute: async (input: unknown) => {
          captured.push({ arguments: input as Record<string, unknown> });
          return { customer_id: randomUUID(), created: true };
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

function judge(captured: CapturedCall[]): { verdict: string; detail: string } {
  if (captured.length === 0) {
    return { verdict: "NO CALL", detail: "createCustomer was never called this scenario." };
  }
  const args = captured[captured.length - 1].arguments;
  const name = args["name"];
  const phone = args["phone"];
  const nameIsObject =
    typeof name === "object" &&
    name !== null &&
    typeof (name as Record<string, unknown>)["first"] === "string" &&
    ((name as Record<string, unknown>)["first"] as string).length > 0 &&
    typeof (name as Record<string, unknown>)["last"] === "string" &&
    ((name as Record<string, unknown>)["last"] as string).length > 0;
  const phoneOk = typeof phone === "string" && phone.length > 0;
  if (nameIsObject && phoneOk) {
    return {
      verdict: "PASS",
      detail: `name=${JSON.stringify(name)} phone=${JSON.stringify(phone)}`,
    };
  }
  return {
    verdict: "FAIL",
    detail: `name=${JSON.stringify(name)} (object with first/last: ${nameIsObject}) phone=${JSON.stringify(phone)} (present: ${phoneOk})`,
  };
}

async function runScenario(
  label: string,
  callerAni: string | null,
  turns: string[],
): Promise<void> {
  console.log(`\n########## ${label} ##########`);
  const repository = new FakeConversationRepository();
  const { conversation, conversationId } = buildConversation(callerAni);
  repository.seed(conversation);
  const captured: CapturedCall[] = [];
  const { useCase, allowedTools } = buildUseCase(repository, captured);

  for (const turn of turns) {
    const { text, toolCalls } = await runTurn(useCase, conversationId, allowedTools, turn);
    console.log(`Caller: ${turn}`);
    console.log(`CSR:    ${text}`);
    if (toolCalls.length > 0) {
      console.log(`        [tools called: ${toolCalls.join(", ")}]`);
    }
  }

  const { verdict, detail } = judge(captured);
  console.log(`RESULT: ${verdict} — ${detail}`);
}

async function main(): Promise<void> {
  console.log(`Model: ${model}`);

  await runScenario("1: full name in one breath, ANI present, phone never spoken", "+15552014477", [
    "Hi, my water heater stopped working completely.",
    "My name is Jordan Ellis.",
    "It's been out since this morning, no hot water at all.",
    "Yeah, go ahead and get that submitted.",
  ]);

  await runScenario(
    "2: first name only, last name given later in a separate turn",
    "+15552014477",
    [
      "Hi, I've got a leak under my sink.",
      "My name's Jordan.",
      "Oh — it's Ellis, sorry, Jordan Ellis.",
      "That's everything, thanks.",
    ],
  );

  await runScenario("3: caller gives a DIFFERENT phone number than their own ANI", "+15552014477", [
    "Hi, my name is Jordan Ellis, my water heater's out.",
    "Actually, better to reach me at 555-980-1122, not this number.",
    "That's everything, please submit it.",
  ]);

  await runScenario("4: ANI present, caller never mentions phone at all", "+15559871234", [
    "Hi, this is Morgan Reyes calling about a clogged drain.",
    "It's in the kitchen, been backing up for two days.",
    "Yeah that's all, go ahead and get someone out.",
  ]);

  await runScenario("5: hyphenated / multi-word last name", "+15552014477", [
    "Hi, my name is Alex Rivera-Gomez, my furnace won't turn on.",
    "That's everything, thanks.",
  ]);

  await runScenario("6: name and address given together in one long turn", "+15552014477", [
    "Hi, I'm Taylor Brooks at 742 Evergreen Terrace, and my water heater's leaking.",
    "That's it, please get that submitted.",
  ]);

  await runScenario(
    "7: caller corrects a misheard name before createCustomer fires",
    "+15552014477",
    [
      "Hi, my name is Katherine Lin, my sink's clogged.",
      "Actually it's Catherine, with a C, not a K.",
      "That's everything, thanks.",
    ],
  );

  await runScenario("8: no ANI at all — caller must give a number themselves", null, [
    "Hi, my name is Sam Okafor, my AC isn't cooling.",
    "You can reach me at 555-444-8899.",
    "That's everything, go ahead.",
  ]);

  await runScenario(
    "9: caller gives just one name word — model should ask, not guess",
    "+15552014477",
    ["Hi, this is Devon, my toilet's overflowing.", "That's it for now, please submit it."],
  );

  await runScenario("10: name given across a fragmented, multi-turn exchange", "+15552014477", [
    "Hi, my name is",
    "sorry, it's Riley",
    "Riley Chen, my heater's making a weird noise.",
    "That's everything, thanks.",
  ]);

  console.log(
    "\n(Each scenario prints the real model transcript above its own RESULT line — read the " +
      "transcript directly for scenarios 8/9, where a real, well-behaved model may reasonably " +
      "still be asking a clarifying question rather than having called createCustomer yet; " +
      "'NO CALL' there is not automatically a failure, only a PASS/FAIL on an actual malformed " +
      "call is.)",
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
  console.error("M1 createCustomer-argument measurement run failed:", error);
  process.exit(1);
});
