import { CreateCustomerInputSchema, TOOL_CATALOG } from "./tool-catalog";

describe("CreateCustomerInputSchema", () => {
  /**
   * Regression coverage for a real, live-reproduced fixation bug: this
   * schema used to require a full address, so a caller who wouldn't (or
   * couldn't, mid-call) give a street address left the model with no
   * valid createCustomer call to make — it kept asking instead, a real
   * transcript showed it asking "what's the street address" four times
   * in a row, including after the caller had already said "yes, that
   * all sounds good, thank you." core-api's own DTO
   * (create-customer-tool.dto.ts) already treats address as optional;
   * this schema now matches that instead of being stricter than the
   * backend it feeds.
   */
  it("accepts a customer with no address at all", () => {
    const result = CreateCustomerInputSchema.safeParse({
      name: { first: "Jane", last: "Doe" },
      phone: "+15551234567",
      source: "ai_csr",
    });

    expect(result.success).toBe(true);
  });

  /**
   * The SAME fixation bug as the address one above, found the same way,
   * one field over — and left in place when address was fixed. `last`
   * was `z.string().min(1)`, so a caller giving only a first name
   * ("it's just Gary", "there is no last name") left NO valid
   * createCustomer call available: every attempt failed validation, so
   * the model re-asked until the caller hung up. Two real calls: one
   * deadlocked with `tool_rejected: name.last` and captured nothing at
   * all, and one escaped by fabricating `{first:"Gary", last:"Gary"}` —
   * a required field manufacturing false data onto a real customer
   * record. A first name plus a phone number is a workable lead.
   */
  it("accepts a first name with NO last name — a caller who only gives one name must not deadlock the tool", () => {
    const result = CreateCustomerInputSchema.safeParse({
      name: { first: "Gary" },
      phone: "+15551234567",
      source: "ai_csr",
    });

    expect(result.success).toBe(true);
  });

  it("still rejects a missing FIRST name — that half stays required", () => {
    const result = CreateCustomerInputSchema.safeParse({
      name: { last: "Doe" },
      phone: "+15551234567",
      source: "ai_csr",
    });

    expect(result.success).toBe(false);
  });

  it("does not advertise `last` as required in the schema the model actually sees", () => {
    const tool = TOOL_CATALOG.find((t) => t.name === "createCustomer");
    const nameSchema = (tool?.jsonSchema as { properties: { name: { required: string[] } } })
      .properties.name;

    expect(nameSchema.required).toEqual(["first"]);
  });

  it("accepts a PARTIAL address — whatever the caller actually gave, not all-or-nothing", () => {
    const result = CreateCustomerInputSchema.safeParse({
      name: { first: "Jane", last: "Doe" },
      phone: "+15551234567",
      address: { city: "Chicago", state: "IL" },
      source: "ai_csr",
    });

    expect(result.success).toBe(true);
  });

  it("still accepts a full address, unchanged from before", () => {
    const result = CreateCustomerInputSchema.safeParse({
      name: { first: "Jane", last: "Doe" },
      phone: "+15551234567",
      address: { street: "123 Main St", city: "Chicago", state: "IL", zip: "60601" },
      source: "ai_csr",
    });

    expect(result.success).toBe(true);
  });

  it("still requires phone — that field is a genuine, multi-layer requirement in core-api (DTO + Prisma NOT NULL + CRM sync), not loosened by this fix", () => {
    const result = CreateCustomerInputSchema.safeParse({
      name: { first: "Jane", last: "Doe" },
      source: "ai_csr",
    });

    expect(result.success).toBe(false);
  });

  /**
   * M1 (real forensic call finding): the model once sent `name` as a bare
   * string ("Akash") instead of the required `{first, last}` object, and
   * separately omitted `phone` entirely on the same call despite a valid
   * Caller ANI being available the whole time. The mission's own
   * instruction was explicit: do NOT weaken this schema to work around
   * that — the fix belongs in the SMALLEST layer that actually caused it
   * (the tool's own per-field descriptions, see the `TOOL_CATALOG`
   * describe block below), not in loosened validation. This is the
   * guardrail that proves that boundary was respected.
   */
  it("M1 GUARDRAIL: still rejects `name` as a bare string — the schema fix boundary was never touched", () => {
    const result = CreateCustomerInputSchema.safeParse({
      name: "Akash",
      phone: "+15551234567",
      source: "ai_csr",
    });

    expect(result.success).toBe(false);
  });
});

/**
 * M1: the real, traced root cause was that `createCustomer`'s jsonSchema
 * — the exact structure the model reads at the moment it constructs a
 * tool call, more local and more direct than the platform prompt's own
 * (already-extensive, see prompt-layers.ts) general ANI/name guidance —
 * had a thoughtful per-field `description` on `address` but NONE at all
 * on `name` or `phone`, the two fields that were actually wrong on the
 * real call. `address`'s own description already proved this exact
 * mechanism works (see tool-catalog.ts's own comment on why `address`
 * became optional); `name`/`phone` simply never got the same treatment.
 */
describe("TOOL_CATALOG createCustomer — per-field descriptions (M1)", () => {
  const createCustomer = TOOL_CATALOG.find((tool) => tool.name === "createCustomer");
  const nameProperty = (createCustomer?.jsonSchema["properties"] as Record<string, any>)?.["name"];
  const phoneProperty = (createCustomer?.jsonSchema["properties"] as Record<string, any>)?.[
    "phone"
  ];

  it("the `name` property's own description explicitly says it must be an object, never a plain string", () => {
    expect(nameProperty?.description).toEqual(
      expect.stringContaining("never a single combined string"),
    );
    expect(nameProperty?.description).toEqual(expect.stringContaining("object"));
  });

  it("the `phone` property's own description explicitly points the model at the caller's ANI instead of leaving it to omit the field", () => {
    expect(phoneProperty?.description).toEqual(expect.stringContaining("Caller ANI"));
    expect(phoneProperty?.description).toEqual(expect.stringContaining("E.164"));
  });

  it("the required array is unchanged — name/phone/source still required, this was a description-only fix", () => {
    expect(createCustomer?.jsonSchema["required"]).toEqual(["name", "phone", "source"]);
  });
});
