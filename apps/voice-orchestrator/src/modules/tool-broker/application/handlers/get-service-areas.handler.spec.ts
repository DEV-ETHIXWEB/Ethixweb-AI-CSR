import { GetServiceAreasHandler } from "./get-service-areas.handler";

describe("GetServiceAreasHandler", () => {
  it("defaults to in-service-area (never falsely turns away a real customer with no backing module)", async () => {
    const handler = new GetServiceAreasHandler();

    const result = await handler.execute(
      { business_id: "business-1", zip: "60601" },
      { tenantId: "t", businessId: "business-1", callId: "c" },
    );

    expect(result).toEqual({ inServiceArea: true });
  });
});
