import { FakeCoreApiClient } from "../__fakes__/fake-core-api-client";
import { CreateCustomerHandler } from "./create-customer.handler";

const context = { tenantId: "t", businessId: "business-1", callId: "call-1" };

describe("CreateCustomerHandler", () => {
  it("creates a customer via core-api and returns its id", async () => {
    const client = new FakeCoreApiClient();
    client.postResponses.set("/internal/customers", { id: "customer-1" });
    const handler = new CreateCustomerHandler(client);

    const result = await handler.execute(
      {
        name: { first: "Jane", last: "Doe" },
        phone: "+15551234567",
        address: { street: "123 Main St", city: "Chicago", state: "IL", zip: "60601" },
        source: "ai_csr",
      },
      context,
    );

    expect(result).toEqual({ customer_id: "customer-1", created: true });
    expect(client.postCalls[0]?.body).toMatchObject({
      businessId: "business-1",
      name: "Jane Doe",
      phoneE164: "+15551234567",
    });
  });

  /**
   * Regression coverage for a real, live-reproduced fixation bug: with
   * address required on this tool's own input schema, the model had no
   * valid way to call createCustomer for a caller who wouldn't give a
   * street address, so it kept asking instead of ever calling this tool
   * (a real transcript showed it asking four times in a row, including
   * after a clear close signal). core-api's own DTO already treats
   * address as optional (create-customer-tool.dto.ts) — this proves the
   * handler forwards that correctly with address entirely omitted.
   */
  it("creates a customer with no address at all — core-api already accepts this, the tool must not block on it", async () => {
    const client = new FakeCoreApiClient();
    client.postResponses.set("/internal/customers", { id: "customer-1" });
    const handler = new CreateCustomerHandler(client);

    const result = await handler.execute(
      { name: { first: "Jane", last: "Doe" }, phone: "+15551234567", source: "ai_csr" },
      context,
    );

    expect(result).toEqual({ customer_id: "customer-1", created: true });
    expect(client.postCalls[0]?.body).toMatchObject({
      name: "Jane Doe",
      phoneE164: "+15551234567",
      address: undefined,
    });
  });

  it("sources businessId from context, not from model input (docs/04 §3.2)", async () => {
    const client = new FakeCoreApiClient();
    client.postResponses.set("/internal/customers", { id: "customer-1" });
    const handler = new CreateCustomerHandler(client);
    const differentContext = { tenantId: "t", businessId: "business-2", callId: "call-1" };

    await handler.execute(
      {
        name: { first: "Jane", last: "Doe" },
        phone: "+15551234567",
        address: { street: "123 Main St", city: "Chicago", state: "IL", zip: "60601" },
        source: "ai_csr",
      },
      differentContext,
    );

    expect(client.postCalls[0]?.body).toMatchObject({ businessId: "business-2" });
  });
});
