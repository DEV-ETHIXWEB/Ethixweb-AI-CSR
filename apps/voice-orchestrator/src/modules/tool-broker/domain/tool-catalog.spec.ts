import { CreateCustomerInputSchema } from "./tool-catalog";

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
});
