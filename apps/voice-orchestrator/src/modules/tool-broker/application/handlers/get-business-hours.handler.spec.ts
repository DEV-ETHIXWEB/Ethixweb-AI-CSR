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

    const result = await handler.execute({}, context);

    expect(result).toEqual({ isOpen: true, opensAt: null, isHoliday: false });
  });

  it("sources businessId from context, not from model input (docs/04 §3.6)", async () => {
    const client = new FakeCoreApiClient();
    client.getResponses = new Map([
      [
        "/internal/emergency-rules/business-hours?businessId=business-2",
        { isOpen: false, opensAt: null, isHoliday: false },
      ],
    ]);
    const handler = new GetBusinessHoursHandler(client);
    const differentContext = { tenantId: "t", businessId: "business-2", callId: "c" };

    const result = await handler.execute({}, differentContext);

    expect(result).toEqual({ isOpen: false, opensAt: null, isHoliday: false });
  });
});
