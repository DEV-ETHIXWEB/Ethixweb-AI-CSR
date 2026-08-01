import { FakeCoreApiClient } from "../__fakes__/fake-core-api-client";
import { UpdateLeadHandler } from "./update-lead.handler";

const context = { tenantId: "t", businessId: "business-1", callId: "call-1" };

describe("UpdateLeadHandler", () => {
  it("patches the lead via core-api, passing the context's callId for authorization", async () => {
    const client = new FakeCoreApiClient();
    client.patchResponses.set("/internal/leads/lead-1", { id: "lead-1" });
    const handler = new UpdateLeadHandler(client);

    const result = await handler.execute(
      { lead_id: "lead-1", patch: { priority: "emergency" } },
      context,
    );

    expect(result).toEqual({ lead_id: "lead-1", updated: true });
    expect(client.patchCalls[0]).toEqual({
      path: "/internal/leads/lead-1",
      body: {
        callId: "call-1",
        problemSummary: undefined,
        priority: "emergency",
        leadType: undefined,
      },
    });
  });
});
