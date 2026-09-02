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

    const result = await handler.execute({ description: "gas leak" }, context);

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

  it("sources businessId/callId from context, not from model input (docs/04 §3.8)", async () => {
    const client = new FakeCoreApiClient();
    client.postResponses.set("/internal/emergency-rules/escalate", {
      isEmergency: false,
      severity: "medium",
      action: "standard_lead",
      transferTargets: [],
    });
    const handler = new EscalateEmergencyHandler(client);
    const differentContext = { tenantId: "t", businessId: "business-2", callId: "call-2" };

    await handler.execute({ description: "dripping faucet" }, differentContext);

    expect(client.postCalls[0]?.body).toMatchObject({ businessId: "business-2", callId: "call-2" });
  });
});
