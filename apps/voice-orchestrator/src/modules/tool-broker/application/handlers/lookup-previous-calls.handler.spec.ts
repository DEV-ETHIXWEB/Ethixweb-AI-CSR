import { LookupPreviousCallsHandler } from "./lookup-previous-calls.handler";

describe("LookupPreviousCallsHandler", () => {
  it("always returns an empty list (no backing calls module exists yet) — degraded but never blocking", async () => {
    const handler = new LookupPreviousCallsHandler();

    const result = await handler.execute(
      { customer_id: "customer-1", limit: 5 },
      { tenantId: "t", businessId: "business-1", callId: "c" },
    );

    expect(result).toEqual({ calls: [] });
  });
});
