import { GetBusinessHoursHandler } from "./get-business-hours.handler";

describe("GetBusinessHoursHandler", () => {
  it("always returns the documented conservative after-hours fallback (no backing business-hours module exists yet)", async () => {
    const handler = new GetBusinessHoursHandler();

    const result = await handler.execute(
      { business_id: "business-1" },
      { tenantId: "t", businessId: "business-1", callId: "c" },
    );

    expect(result).toEqual({ isOpen: false, isHoliday: false });
  });
});
