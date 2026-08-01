import { FakeCoreApiClient } from "../__fakes__/fake-core-api-client";
import { GetBusinessHoursHandler } from "./get-business-hours.handler";

const context = { tenantId: "t", businessId: "business-1", callId: "c" };

describe("GetBusinessHoursHandler", () => {
  it("delegates to core-api's emergency-rules module via the internal tool endpoint", async () => {
    const client = new FakeCoreApiClient();
    client.getResponses = new Map([
      [
        "/internal/emergency-rules/business-hours?businessId=business-1",
        { isOpen: true, opensAt: null, isHoliday: false },
      ],
    ]);
    const handler = new GetBusinessHoursHandler(client);

    const result = await handler.execute({ business_id: "business-1" }, context);

    expect(result).toEqual({ isOpen: true, opensAt: null, isHoliday: false });
  });
});
