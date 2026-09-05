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

// v16 scenarios specifically test whether the model actually uses Caller
// ANI for a proactive searchCustomer lookup — needs the REAL
// formatRuntimeContext shape (not the hand-written approximation above,
// which predates that rule and has no ANI line at all) so the exact
// "Caller ANI: ... -> searchCustomer already run: not yet run" text the
// model sees in production is what's being tested against, not a
// simplified stand-in.
const SYSTEM_PROMPT_WITH_ANI = assembleLayeredPrompt({
  platformBase: PLATFORM_BASE_PROMPT_V1,
  tenantDefault: DEFAULT_BRAND_VOICE_PROMPT,
  businessOverride: "",
  runtimeContext: formatRuntimeContext({
    currentTimeIso: new Date().toISOString(),
    timezone: "America/Chicago",
    businessHours: { isOpen: true, isHoliday: false },
    callerAni: "+15558127744",
    existingCustomerMatch: null,
  }),
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
  /**
   * Uses SYSTEM_PROMPT_WITH_ANI (the real formatRuntimeContext shape,
   * carrying a Caller ANI line) instead of the default hand-written
   * runtime context — only scripts specifically testing v16's
   * ANI-lookup rule need this; every other script's simplified context
   * has no ANI line at all, which would make "does the model use the
   * ANI" untestable rather than a meaningful negative result.
   */
  useAniPrompt?: boolean;
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
  {
    name: "QA mission Phase 6: name correction must actually stick",
    focus:
      "Caller gives 'John Smith', then corrects to 'John Smythe' — every mention afterward, and any tool call, must use Smythe, not Smith. This is the single most concrete, checkable memory-correctness test: either the transcript says Smythe from that point on or it doesn't.",
    turns: [
      "Hi, my garbage disposal stopped working entirely.",
      "My name is John Smith.",
      "Actually, sorry, it's John Smythe, S-M-Y-T-H-E.",
      "My phone number is 555-822-1199.",
      "Can you just confirm the name and number you have for me?",
    ],
    enableTools: true,
  },
  {
    name: "QA mission Phase 6: address correction must actually stick",
    focus:
      "Caller gives '17 Birchwood Lane', then corrects to '19 Birchwood Lane' — the same test as the name correction above, for an address instead. Any recap or tool call afterward must use 19, not 17.",
    turns: [
      "Hi, I've got a burst pipe under my kitchen sink, water everywhere.",
      "My address is 17 Birchwood Lane.",
      "Sorry, that's wrong — it's 19 Birchwood Lane, not 17.",
      "My name is Priya Nair, phone is 555-440-2210.",
      "Can you read that address back to me before we hang up?",
    ],
    enableTools: true,
  },
  {
    name: "QA mission Phase 9: topic change and return (problem -> pricing -> problem)",
    focus:
      "Caller interrupts their own problem description to ask an unrelated pricing question, then expects the conversation to pick back up where it left off — not restart, not ignore the pricing question, not get stuck on either topic.",
    turns: [
      "Hi, my AC isn't cooling the house at all.",
      "Actually, before we get into that — how much do you typically charge just for a diagnostic visit?",
      "Okay that's helpful. So yeah, the AC — it's been blowing room-temperature air since this morning.",
      "It's a two-story house, upstairs is worse than downstairs.",
    ],
  },
  {
    name: "QA mission Phase 18: dead-air / 'are you there' recovery",
    focus:
      "A caller asking 'hello?' / 'are you still there?' mid-conversation must get an immediate, direct, human-sounding response acknowledging them — never silence, never a generic restart, never ignoring that they just asked a direct question.",
    turns: [
      "Hi, I need someone to look at my water heater, it's making a banging noise.",
      "Hello? Are you still there?",
      "Can you hear me okay?",
    ],
  },
  {
    name: "QA mission Phase 10: urgency and emotion (panicked caller, active flooding)",
    focus:
      "A caller describing active, ongoing damage with visible urgency/distress should get a brief, human acknowledgment before questions continue — not a canned phrase, not a long detour, and the model should not casually continue with routine qualifying questions as if nothing was said.",
    turns: [
      "Oh my god, okay, um, water is just pouring out from under my sink right now, it's flooding my kitchen, I don't know what to do.",
      "I already turned off the water at the wall but there's still water everywhere on the floor.",
      "Please, how fast can someone get here?",
    ],
    enableTools: true,
  },
  {
    name: "v16: returning caller — uses Caller ANI for an immediate searchCustomer lookup, never asks for the phone number verbally",
    focus:
      "The system prompt's own runtime context already carries the caller's phone number (Caller ANI) before any turn happens. A real dispatcher's caller-ID would look this caller up immediately — the model should too, and once searchCustomer finds a match (Marcus Webb, scripted below), it should use that name naturally instead of asking the caller to introduce themselves or read out their number.",
    turns: [
      "Hi, my kitchen faucet won't turn off all the way, it's dripping constantly.",
      "Yeah that's right, it's been going on for about a week.",
    ],
    enableTools: true,
    useAniPrompt: true,
  },
  {
    name: "v17: returning caller with real service history — lookupPreviousCalls actually gets called and used",
    focus:
      "Direct evidence this was previously broken: a caller saying 'it's Marcus again' with real prior service history available (a disposal issue, scripted below) got lookupPreviousCalls called zero times before v17 — treated as a first-time issue with no continuity. The model should call lookupPreviousCalls once searchCustomer finds a match, and use anything relevant naturally.",
    turns: ["Hi, it's Marcus again, my kitchen sink is backing up now too."],
    enableTools: true,
    useAniPrompt: true,
  },
  {
    name: "v16: 'I already told you' — own it, don't over-apologize or restart",
    focus:
      "v13's 'stop asking a third time' rule covers a caller who redirects; this is the sharper case — the caller explicitly calls out being asked again. The model should briefly own it and move on, not apologize repeatedly or get stuck.",
    turns: [
      "Hi, my garage disposal is jammed and it's making a horrible grinding noise.",
      "It's a General Electric, about eight years old.",
      "I already told you it's a GE, why are you asking again?",
    ],
    enableTools: true,
  },
  {
    name: "v16: current intent first — a direct business-hours question mid-flow must get answered, not deferred",
    focus:
      "Generalizes v13's narrow 'respond to a different field' rule: ANY direct question (not just a different qualifying field) is the caller's current priority. The model has getBusinessHours available and should use it, not dodge the question to keep qualifying.",
    turns: [
      "Hi, my bathroom sink is clogged and draining really slowly.",
      "Actually wait — are you guys open right now? It's pretty late.",
      "Okay good. So yeah, the sink's been slow for about three days now.",
    ],
    enableTools: true,
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
  let searchCustomerHandler: FakeToolHandler | null = null;
  let lookupPreviousCallsHandler: FakeToolHandler | null = null;
  if (script.enableTools) {
    for (const definition of TOOL_CATALOG) {
      const handler = new FakeToolHandler();
      // Existing scripts (v12/v13/emergency) were verified assuming a
      // NEW-customer flow (found: false, then createCustomer) — changing
      // that would silently invalidate their own already-verified
      // results. Only useAniPrompt scripts (specifically testing the
      // v16/v17 ANI-lookup + call-history rules) get a "found" match and
      // real-looking call history, matching what those rules are
      // actually meant to exercise.
      if (script.useAniPrompt && definition.name === "searchCustomer") {
        handler.output = { found: true, customer: { id: randomUUID(), name: "Marcus Webb", address: null } };
      } else if (script.useAniPrompt && definition.name === "lookupPreviousCalls") {
        handler.output = {
          calls: [
            {
              date: "2026-08-20",
              problemSummary: "Kitchen sink garbage disposal jammed, cleared on-site.",
              resolved: true,
            },
          ],
        };
      } else {
        handler.output = { id: randomUUID(), found: false, isEmergency: false };
      }
      toolRegistry.register(definition, handler);
      allowedTools.push(definition.name);
      if (definition.name === "searchCustomer") {
        searchCustomerHandler = handler;
      }
      if (definition.name === "lookupPreviousCalls") {
        lookupPreviousCallsHandler = handler;
      }
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
    systemPrompt: script.useAniPrompt ? SYSTEM_PROMPT_WITH_ANI : SYSTEM_PROMPT,
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
    const searchCustomerCallsBefore = searchCustomerHandler?.callCount ?? 0;
    const result = await useCase.execute(command);
    console.log(`Caller: ${callerText}`);
    console.log(`CSR:    ${result.responseText}`);
    if (result.toolCallsExecuted.length > 0) {
      console.log(`        [tools called: ${result.toolCallsExecuted.join(", ")}]`);
    }
    if (searchCustomerHandler && searchCustomerHandler.callCount > searchCustomerCallsBefore) {
      console.log(
        `        [searchCustomer called with: ${JSON.stringify(searchCustomerHandler.receivedInputs.at(-1))}]`,
      );
    }
    if (lookupPreviousCallsHandler) {
      console.log(
        lookupPreviousCallsHandler.callCount > 0
          ? `        [lookupPreviousCalls WAS called]`
          : `        [lookupPreviousCalls was NEVER called]`,
      );
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
