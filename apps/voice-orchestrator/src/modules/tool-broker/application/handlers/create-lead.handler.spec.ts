import { FakeCoreApiClient } from "../__fakes__/fake-core-api-client";
import { CreateLeadHandler } from "./create-lead.handler";

const context = { tenantId: "t", businessId: "business-1", callId: "call-1" };

describe("CreateLeadHandler", () => {
  it("creates a lead via core-api's internal endpoint and returns lead_id/status", async () => {
    const client = new FakeCoreApiClient();
    client.postResponses.set("/internal/leads", { id: "lead-1" });
    const handler = new CreateLeadHandler(client);

    const result = await handler.execute(
      {
        customer_id: "customer-1",
        business_id: "business-1",
        call_id: "call-1",
        problem_summary: "Water heater leaking",
        priority: "urgent",
        lead_type: "residential",
      },
      context,
    );

    expect(result).toEqual({ lead_id: "lead-1", status: "created" });
    expect(client.postCalls[0]).toEqual({
      path: "/internal/leads",
      body: {
        businessId: "business-1",
        customerId: "customer-1",
        callId: "call-1",
        problemSummary: "Water heater leaking",
        priority: "urgent",
        leadType: "residential",
      },
    });
  });
});
