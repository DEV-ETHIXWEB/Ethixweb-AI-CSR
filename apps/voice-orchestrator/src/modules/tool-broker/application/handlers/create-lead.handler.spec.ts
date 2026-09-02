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

  /**
   * Regression coverage for a real bug found live: the tool schema used to
   * expose business_id/call_id as model-fillable parameters, and a real
   * transcript showed the model asking the caller "which business am I
   * helping you with?" rather than inventing them. Now the handler has no
   * `input.business_id`/`input.call_id` to read at all — this proves the
   * REST call is built entirely from context, not from model output, no
   * matter what businessId/callId the call is actually running on.
   */
  it("sources businessId/callId from context, not from model input (docs/04 §3.3)", async () => {
    const client = new FakeCoreApiClient();
    client.postResponses.set("/internal/leads", { id: "lead-1" });
    const handler = new CreateLeadHandler(client);
    const differentContext = { tenantId: "t", businessId: "business-2", callId: "call-2" };

    await handler.execute(
      {
        customer_id: "customer-1",
        problem_summary: "Water heater leaking",
        priority: "urgent",
        lead_type: "residential",
      },
      differentContext,
    );

    expect(client.postCalls[0]?.body).toMatchObject({ businessId: "business-2", callId: "call-2" });
  });
});
