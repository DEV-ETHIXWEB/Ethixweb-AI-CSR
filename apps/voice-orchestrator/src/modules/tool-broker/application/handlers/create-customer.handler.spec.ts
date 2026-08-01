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
        business_id: "business-1",
        name: { first: "Jane", last: "Doe" },
        phone: "+15551234567",
        address: { street: "123 Main St", city: "Chicago", state: "IL", zip: "60601" },
        source: "ai_csr",
      },
      context,
    );

    expect(result).toEqual({ customer_id: "customer-1", created: true });
    expect(client.postCalls[0]?.body).toMatchObject({
      name: "Jane Doe",
      phoneE164: "+15551234567",
    });
  });
});
