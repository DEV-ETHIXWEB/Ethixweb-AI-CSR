import { EscalateEmergencyHandler } from "./escalate-emergency.handler";

const context = { tenantId: "t", businessId: "business-1", callId: "call-1" };

describe("EscalateEmergencyHandler", () => {
  it.each([
    "water heater is leaking everywhere",
    "I smell gas near the meter",
    "the basement is flooding",
  ])(
    "treats fail-safe keyword language ('%s') as priority_notify, never silently downgraded",
    async (description) => {
      const handler = new EscalateEmergencyHandler();

      const result = await handler.execute(
        { business_id: "business-1", call_id: "call-1", description },
        context,
      );

      expect(result).toEqual({ isEmergency: true, severity: "medium", action: "priority_notify" });
    },
  );

  it("treats ordinary language as a standard lead, not an emergency", async () => {
    const handler = new EscalateEmergencyHandler();

    const result = await handler.execute(
      {
        business_id: "business-1",
        call_id: "call-1",
        description: "my kitchen faucet drips a little",
      },
      context,
    );

    expect(result).toEqual({ isEmergency: false, severity: "medium", action: "standard_lead" });
  });

  it("also checks detected_keywords, not just the free-text description", async () => {
    const handler = new EscalateEmergencyHandler();

    const result = await handler.execute(
      {
        business_id: "business-1",
        call_id: "call-1",
        description: "not sure what's wrong",
        detected_keywords: ["gas"],
      },
      context,
    );

    expect(result.isEmergency).toBe(true);
  });
});
