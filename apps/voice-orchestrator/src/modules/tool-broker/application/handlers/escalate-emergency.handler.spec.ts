import { FakeCoreApiClient } from "../__fakes__/fake-core-api-client";
import { EscalateEmergencyHandler } from "./escalate-emergency.handler";

const context = { tenantId: "t", businessId: "business-1", callId: "call-1" };

describe("EscalateEmergencyHandler", () => {
  it("delegates to core-api's emergency-rules module via the internal tool endpoint", async () => {
    const client = new FakeCoreApiClient();
    client.postResponses.set("/internal/emergency-rules/escalate", {
      isEmergency: true,
      severity: "critical",
      action: "forward_call",
      transferTargets: ["+15551234567"],
    });
    const handler = new EscalateEmergencyHandler(client);

    const result = await handler.execute(
      { business_id: "business-1", call_id: "call-1", description: "gas leak" },
      context,
    );

    expect(result).toEqual({
      isEmergency: true,
      severity: "critical",
      action: "forward_call",
      transferTargets: ["+15551234567"],
    });
    expect(client.postCalls[0]).toEqual({
      path: "/internal/emergency-rules/escalate",
      body: {
        businessId: "business-1",
        callId: "call-1",
        description: "gas leak",
        detectedKeywords: undefined,
      },
    });
  });
});
