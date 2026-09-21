import { z } from "zod";
import type { ToolDefinition } from "./tool-definition";

/**
 * docs/04-ai-tool-architecture.md §3's tool registry, translated into
 * zod schemas + versioned metadata — "the LLM's entire capability surface
 * is exactly this document" (§1). `sendNotification` (§3.5) is
 * deliberately excluded: docs/04 §3.5 states it explicitly, "not exposed
 * to the LLM as a free-form tool," a deterministic side effect of
 * createLead instead. Eight tools from docs/04, plus `transferToHuman`
 * (added post-docs, see its own comment below) — nine total.
 *
 * Timeout/retry values are transcribed from each tool's own docs/04 §3.x
 * table where stated. `getServiceAreas` (§3.7) has no documented
 * Timeout/Retries row — 1500ms / no retry here is an INFERRED default
 * (matching the fast-fail posture of its sibling read-only tools §3.6/3.9),
 * not a verbatim requirement, flagged the same way lead-lifecycle.ts flags
 * its own inferred `abandoned` transitions.
 *
 * `business_id`/`call_id` are DELIBERATELY absent from every schema below
 * — found live, not hypothetical: 6 of these 8 tools previously declared
 * them as model-fillable parameters, and a real transcript showed the
 * model doing exactly what an undocumented, un-contextualized UUID
 * parameter forces it to do: asking the caller "which business am I
 * helping you with today?" (or, worse, inventing a plausible-looking but
 * wrong UUID). `ExecuteToolUseCase` already threads the real, trusted
 * `businessId`/`callId` into every handler via `ToolHandlerContext` — the
 * SAME values `UpdateLeadHandler` already correctly used, the pattern
 * every other handler now follows too. This isn't just a confusing-caller-
 * experience fix: a model-supplied business_id is also a real
 * cross-business data-integrity risk for any tenant with more than one
 * business, since nothing server-side was verifying the model's own
 * invented value against the call it was actually running on.
 */

const e164 = z.string().regex(/^\+[1-9]\d{1,14}$/, "must be E.164");
const uuid = z.string().uuid();

export const SearchCustomerInputSchema = z.object({
  phone: e164,
});
export type SearchCustomerInput = z.infer<typeof SearchCustomerInputSchema>;

/**
 * `address` is deliberately OPTIONAL, not required — core-api's own
 * CreateCustomerToolDto (create-customer-tool.dto.ts) already accepts it
 * as `@IsOptional()`; nothing downstream needs it to create a customer
 * record. Requiring it HERE, in the schema the model actually sees, was
 * a real, found-live bug: a call's real transcript showed the model
 * asking "what's the street address" FOUR TIMES IN A ROW, including
 * after the caller had already said "yes, that all sounds good, thank
 * you" — a clear signal to wrap up. The prompt's own "stop asking a
 * third time" rule (prompt-layers.ts v13) couldn't win against this:
 * the model wasn't ignoring the rule, it structurally COULDN'T comply
 * with it, because address was a required tool argument it had no
 * valid way to omit — "stop asking" left it with no way to actually
 * make progress, so it kept asking, the exact "broken recording"
 * pattern that rule exists to prevent. This schema now matches what
 * the backend actually requires, giving the model a real way to move
 * on: capture the lead with whatever address info exists (even none)
 * rather than blocking the whole call on a field the system doesn't
 * actually need yet.
 */
export const CreateCustomerInputSchema = z.object({
  // `last` is OPTIONAL for the same reason `address` below is, and it was
  // found the same way — on real calls. A hard-required last name is
  // unsatisfiable for a caller who only gives one ("it's just Gary",
  // "there is no last name"), and the model has no way out of that: the
  // tool rejects every attempt, so it re-asks, the caller repeats
  // themselves, and the call ends with no record at all. Seen twice on
  // real calls: one deadlocked into `tool_rejected: name.last` and
  // captured nothing, and another where the model escaped the constraint
  // by fabricating `{first:"Gary", last:"Gary"}` — a required field
  // manufacturing false data on a real customer record, which is worse
  // than the gap it was trying to prevent. A first name plus a phone
  // number is a complete, workable lead; a technician calling back can
  // ask for the rest.
  name: z.object({ first: z.string().min(1), last: z.string().min(1).optional() }),
  phone: e164,
  email: z.string().email().optional(),
  address: z
    .object({
      street: z.string().min(1),
      city: z.string().min(1),
      state: z.string().min(1),
      zip: z.string().min(1),
    })
    .partial()
    .optional(),
  source: z.literal("ai_csr"),
});
export type CreateCustomerInput = z.infer<typeof CreateCustomerInputSchema>;

export const CreateLeadInputSchema = z.object({
  customer_id: uuid,
  problem_summary: z.string().min(1).max(4000),
  priority: z.enum(["emergency", "urgent", "routine", "estimate"]),
  lead_type: z.enum(["residential", "commercial"]),
  preferred_contact_method: z.string().optional(),
  transcript_ref: z.string().optional(),
});
export type CreateLeadInput = z.infer<typeof CreateLeadInputSchema>;

export const UpdateLeadInputSchema = z.object({
  lead_id: uuid,
  patch: z
    .object({
      problem_summary: z.string().min(1).max(4000).optional(),
      priority: z.enum(["emergency", "urgent", "routine", "estimate"]).optional(),
      lead_type: z.enum(["residential", "commercial"]).optional(),
    })
    .strict(),
});
export type UpdateLeadInput = z.infer<typeof UpdateLeadInputSchema>;

export const GetBusinessHoursInputSchema = z.object({
  at: z.string().datetime().optional(),
});
export type GetBusinessHoursInput = z.infer<typeof GetBusinessHoursInputSchema>;

export const GetServiceAreasInputSchema = z.object({
  zip: z.string().min(1),
});
export type GetServiceAreasInput = z.infer<typeof GetServiceAreasInputSchema>;

export const EscalateEmergencyInputSchema = z.object({
  description: z.string().min(1),
  detected_keywords: z.array(z.string()).optional(),
});
export type EscalateEmergencyInput = z.infer<typeof EscalateEmergencyInputSchema>;

/**
 * The non-emergency counterpart to escalateEmergency — see
 * TransferToHumanUseCase's own comment (core-api) for why this exists and
 * why it's kept separate from emergency escalation rather than merged
 * into it. `reason` is a closed enum, not free text: it exists for
 * observability/audit (what kinds of calls actually need a human) and to
 * keep the model from writing something that reads like a hazard
 * description into a field escalateEmergency doesn't see.
 */
export const TransferToHumanInputSchema = z.object({
  reason: z.enum(["caller_requested", "cannot_help", "caller_frustrated", "business_workflow"]),
  summary: z.string().min(1),
});
export type TransferToHumanInput = z.infer<typeof TransferToHumanInputSchema>;

export const LookupPreviousCallsInputSchema = z.object({
  customer_id: uuid,
  limit: z.number().int().positive().max(50).default(5),
});
export type LookupPreviousCallsInput = z.infer<typeof LookupPreviousCallsInputSchema>;

export const TOOL_CATALOG: readonly ToolDefinition[] = [
  {
    name: "searchCustomer",
    version: "v1",
    description:
      "Look up an existing customer by phone before ever creating one. First tool called on every " +
      "inbound call. Use the caller's own Caller ANI already in your context for this — don't ask " +
      "the caller to read their number out loud just to run this lookup.",
    inputSchema: SearchCustomerInputSchema,
    jsonSchema: {
      type: "object",
      properties: {
        phone: {
          type: "string",
          description:
            "The caller's phone number, E.164 format (e.g. +15551234567) — this is the caller's " +
            "own Caller ANI already in your context, not something to ask them for first.",
        },
      },
      required: ["phone"],
    },
    timeoutMs: 2000,
    retryPolicy: { maxAttempts: 3 },
  },
  {
    name: "createCustomer",
    version: "v1",
    description:
      "Create a new CRM customer record — only called after searchCustomer returns found: false. " +
      "Get the caller's street address BEFORE calling this and pass it in the address field: it " +
      "cannot be added afterwards. The call is refused until the caller has given a street address, " +
      "except in a real emergency, or when they have declined to give one or were already asked " +
      "three times. If they decline, call it without an address and carry on.",
    inputSchema: CreateCustomerInputSchema,
    jsonSchema: {
      type: "object",
      properties: {
        name: {
          type: "object",
          description:
            "An object with first and last — never a single combined string. " +
            "Split whatever the caller said the same way you always do: if they gave both in " +
            "one breath (e.g. 'Akash Kumar'), the first word is first and the rest is last. " +
            "Only `first` is required. OMIT `last` entirely when the caller has given just one " +
            "name, or has said they don't have a last name — never invent one, never repeat the " +
            "first name into it, and never withhold this call waiting to collect one. A first " +
            "name and a phone number is a complete, usable record.",
          properties: { first: { type: "string" }, last: { type: "string" } },
          required: ["first"],
        },
        phone: {
          type: "string",
          description:
            "The caller's phone number, E.164 format (e.g. +15551234567). Use the caller's own " +
            "Caller ANI already in your context unless they've explicitly given a different " +
            "number to use instead — don't omit this waiting for them to read a number aloud.",
        },
        email: { type: "string" },
        address: {
          type: "object",
          description: "Optional. Include only the parts the caller actually gave you.",
          properties: {
            street: { type: "string" },
            city: { type: "string" },
            state: { type: "string" },
            zip: { type: "string" },
          },
        },
        source: { type: "string", const: "ai_csr" },
      },
      required: ["name", "phone", "source"],
    },
    timeoutMs: 3000,
    retryPolicy: { maxAttempts: 4 },
  },
  {
    name: "createLead",
    version: "v1",
    description:
      "The single 'commit' action of a qualifying call. Never creates a scheduled job or calendar appointment.",
    inputSchema: CreateLeadInputSchema,
    jsonSchema: {
      type: "object",
      properties: {
        customer_id: { type: "string" },
        problem_summary: { type: "string" },
        priority: { type: "string", enum: ["emergency", "urgent", "routine", "estimate"] },
        lead_type: { type: "string", enum: ["residential", "commercial"] },
        preferred_contact_method: { type: "string" },
        transcript_ref: { type: "string" },
      },
      required: ["customer_id", "problem_summary", "priority", "lead_type"],
    },
    timeoutMs: 3000,
    retryPolicy: { maxAttempts: 5 },
  },
  {
    name: "updateLead",
    version: "v1",
    description: "Amend a lead created earlier in the same call.",
    inputSchema: UpdateLeadInputSchema,
    jsonSchema: {
      type: "object",
      properties: {
        lead_id: { type: "string" },
        patch: {
          type: "object",
          properties: {
            problem_summary: { type: "string" },
            priority: { type: "string", enum: ["emergency", "urgent", "routine", "estimate"] },
            lead_type: { type: "string", enum: ["residential", "commercial"] },
          },
        },
      },
      required: ["lead_id", "patch"],
    },
    timeoutMs: 3000,
    retryPolicy: { maxAttempts: 5 },
  },
  {
    name: "getBusinessHours",
    version: "v1",
    description: "Determine if the business is currently open.",
    inputSchema: GetBusinessHoursInputSchema,
    jsonSchema: {
      type: "object",
      properties: { at: { type: "string" } },
      required: [],
    },
    timeoutMs: 1000,
    retryPolicy: { maxAttempts: 1 },
  },
  {
    name: "getServiceAreas",
    version: "v1",
    description: "Check whether a caller's address/zip is within the business's service area.",
    inputSchema: GetServiceAreasInputSchema,
    jsonSchema: {
      type: "object",
      properties: { zip: { type: "string" } },
      required: ["zip"],
    },
    timeoutMs: 1500,
    retryPolicy: { maxAttempts: 1 },
  },
  {
    name: "escalateEmergency",
    version: "v1",
    description: "Evaluate a described problem against the business's emergency rule set.",
    inputSchema: EscalateEmergencyInputSchema,
    jsonSchema: {
      type: "object",
      properties: {
        description: { type: "string" },
        detected_keywords: { type: "array", items: { type: "string" } },
      },
      required: ["description"],
    },
    timeoutMs: 1500,
    retryPolicy: { maxAttempts: 1 },
  },
  {
    name: "transferToHuman",
    version: "v1",
    description:
      "Transfer the live call to a real team member NOW — the caller leaves this system's control. " +
      "Use only for a NON-emergency handoff: the caller explicitly asked for a person, is clearly " +
      "unable to make progress with you, or the situation is genuinely outside what you can help " +
      "with. Call this THE SAME TURN the caller asks for a human — even if that is the very first " +
      "thing they say, with zero other context. Do not ask what the problem is first; that question " +
      "can wait for whoever picks up. Never use this to escape a hard question you could still " +
      "honestly answer as an AI, and never use this for anything that sounds like an emergency — " +
      "call escalateEmergency for that instead, which has its own, higher-priority transfer path. " +
      "This tool only SIGNALS the request; the actual transfer may still fail (no one reachable), so " +
      "never tell the caller it succeeded until you see the result.",
    inputSchema: TransferToHumanInputSchema,
    jsonSchema: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          enum: ["caller_requested", "cannot_help", "caller_frustrated", "business_workflow"],
        },
        summary: {
          type: "string",
          description:
            "One line for the human who picks up: name/problem/address, whatever is known.",
        },
      },
      required: ["reason", "summary"],
    },
    timeoutMs: 1500,
    retryPolicy: { maxAttempts: 1 },
  },
  {
    name: "lookupPreviousCalls",
    version: "v1",
    description:
      "Give the AI context on repeat callers without re-asking qualification questions from scratch.",
    inputSchema: LookupPreviousCallsInputSchema,
    jsonSchema: {
      type: "object",
      properties: {
        customer_id: { type: "string" },
        limit: { type: "number" },
      },
      required: ["customer_id"],
    },
    timeoutMs: 1500,
    retryPolicy: { maxAttempts: 1 },
  },
];
