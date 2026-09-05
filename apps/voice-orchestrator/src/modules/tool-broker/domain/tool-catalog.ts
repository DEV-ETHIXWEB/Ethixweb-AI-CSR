import { z } from "zod";
import type { ToolDefinition } from "./tool-definition";

/**
 * docs/04-ai-tool-architecture.md §3's tool registry, translated into
 * zod schemas + versioned metadata — "the LLM's entire capability surface
 * is exactly this document" (§1). `sendNotification` (§3.5) is
 * deliberately excluded: docs/04 §3.5 states it explicitly, "not exposed
 * to the LLM as a free-form tool," a deterministic side effect of
 * createLead instead. Eight tools here, not nine.
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
  name: z.object({ first: z.string().min(1), last: z.string().min(1) }),
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
      "Look up an existing customer by phone before ever creating one. First tool called on every inbound call.",
    inputSchema: SearchCustomerInputSchema,
    jsonSchema: {
      type: "object",
      properties: { phone: { type: "string" } },
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
      "address is OPTIONAL — call this with whatever you actually have. Do not withhold this call, " +
      "or keep asking the caller for their address, just to fill in a field nothing downstream " +
      "requires yet; a customer record with a name and phone but no address is a normal, complete " +
      "outcome, not a partial failure.",
    inputSchema: CreateCustomerInputSchema,
    jsonSchema: {
      type: "object",
      properties: {
        name: {
          type: "object",
          properties: { first: { type: "string" }, last: { type: "string" } },
          required: ["first", "last"],
        },
        phone: { type: "string" },
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
