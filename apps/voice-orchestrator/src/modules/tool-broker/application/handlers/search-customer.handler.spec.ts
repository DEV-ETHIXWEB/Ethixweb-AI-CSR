import { FakeCoreApiClient } from "../__fakes__/fake-core-api-client";
import { SearchCustomerHandler } from "./search-customer.handler";

const context = { tenantId: "t", businessId: "business-1", callId: "call-1" };

describe("SearchCustomerHandler", () => {
  it("returns found: false when core-api resolves no match", async () => {
    const client = new FakeCoreApiClient();
    client.postResponses.set("/internal/customers/resolve", null);
    const handler = new SearchCustomerHandler(client);

    const result = await handler.execute(
      { phone: "+15551234567", business_id: "business-1" },
      context,
    );

    expect(result).toEqual({ found: false });
    expect(client.postCalls[0]).toEqual({
      path: "/internal/customers/resolve",
      body: { businessId: "business-1", phoneE164: "+15551234567" },
    });
  });

  it("maps a matched customer's id/name/address, omitting undocumented fields", async () => {
    const client = new FakeCoreApiClient();
    client.postResponses.set("/internal/customers/resolve", {
      id: "customer-1",
      name: "Jane Doe",
      address: { street: "123 Main St" },
    });
    const handler = new SearchCustomerHandler(client);

    const result = await handler.execute(
      { phone: "+15551234567", business_id: "business-1" },
      context,
    );

    expect(result).toEqual({
      found: true,
      customer: { id: "customer-1", name: "Jane Doe", address: { street: "123 Main St" } },
    });
  });
});
