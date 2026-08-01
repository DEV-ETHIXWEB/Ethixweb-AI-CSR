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
 */

const e164 = z.string().regex(/^\+[1-9]\d{1,14}$/, "must be E.164");
const uuid = z.string().uuid();

export const SearchCustomerInputSchema = z.object({
  phone: e164,
  business_id: uuid,
});
export type SearchCustomerInput = z.infer<typeof SearchCustomerInputSchema>;

export const CreateCustomerInputSchema = z.object({
  business_id: uuid,
  name: z.object({ first: z.string().min(1), last: z.string().min(1) }),
  phone: e164,
  email: z.string().email().optional(),
  address: z.object({
    street: z.string().min(1),
    city: z.string().min(1),
    state: z.string().min(1),
    zip: z.string().min(1),
  }),
  source: z.literal("ai_csr"),
});
export type CreateCustomerInput = z.infer<typeof CreateCustomerInputSchema>;

export const CreateLeadInputSchema = z.object({
  customer_id: uuid,
  business_id: uuid,
  call_id: uuid,
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
  business_id: uuid,
  at: z.string().datetime().optional(),
});
export type GetBusinessHoursInput = z.infer<typeof GetBusinessHoursInputSchema>;

export const GetServiceAreasInputSchema = z.object({
  business_id: uuid,
  zip: z.string().min(1),
});
export type GetServiceAreasInput = z.infer<typeof GetServiceAreasInputSchema>;

export const EscalateEmergencyInputSchema = z.object({
  business_id: uuid,
  call_id: uuid,
  description: z.string().min(1),
  detected_keywords: z.array(z.string()).optional(),
});
export type EscalateEmergencyInput = z.infer<typeof EscalateEmergencyInputSchema>;

export const LookupPreviousCallsInputSchema = z.object({
  customer_id: uuid,
  business_id: uuid,
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
      properties: { phone: { type: "string" }, business_id: { type: "string" } },
      required: ["phone", "business_id"],
    },
    timeoutMs: 2000,
    retryPolicy: { maxAttempts: 3 },
  },
  {
    name: "createCustomer",
    version: "v1",
    description:
      "Create a new CRM customer record — only called after searchCustomer returns found: false.",
    inputSchema: CreateCustomerInputSchema,
    jsonSchema: {
      type: "object",
      properties: {
        business_id: { type: "string" },
        name: {
          type: "object",
          properties: { first: { type: "string" }, last: { type: "string" } },
          required: ["first", "last"],
        },
        phone: { type: "string" },
        email: { type: "string" },
        address: {
          type: "object",
          properties: {
            street: { type: "string" },
            city: { type: "string" },
            state: { type: "string" },
            zip: { type: "string" },
          },
          required: ["street", "city", "state", "zip"],
        },
        source: { type: "string", const: "ai_csr" },
      },
      required: ["business_id", "name", "phone", "address", "source"],
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
        business_id: { type: "string" },
        call_id: { type: "string" },
        problem_summary: { type: "string" },
        priority: { type: "string", enum: ["emergency", "urgent", "routine", "estimate"] },
        lead_type: { type: "string", enum: ["residential", "commercial"] },
        preferred_contact_method: { type: "string" },
        transcript_ref: { type: "string" },
      },
      required: [
        "customer_id",
        "business_id",
        "call_id",
        "problem_summary",
        "priority",
        "lead_type",
      ],
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
      properties: { business_id: { type: "string" }, at: { type: "string" } },
      required: ["business_id"],
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
      properties: { business_id: { type: "string" }, zip: { type: "string" } },
      required: ["business_id", "zip"],
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
        business_id: { type: "string" },
        call_id: { type: "string" },
        description: { type: "string" },
        detected_keywords: { type: "array", items: { type: "string" } },
      },
      required: ["business_id", "call_id", "description"],
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
        business_id: { type: "string" },
        limit: { type: "number" },
      },
      required: ["customer_id", "business_id"],
    },
    timeoutMs: 1500,
    retryPolicy: { maxAttempts: 1 },
  },
];
