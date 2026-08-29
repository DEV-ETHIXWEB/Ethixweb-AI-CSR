import { FakeCoreApiClient } from "./__fakes__/fake-core-api-client";
import { HttpTenantStatusProvider } from "./http-tenant-status.provider";

const STATUS_PATH = "/internal/tenant-status";

describe("HttpTenantStatusProvider", () => {
  it("returns the status core-api reports", async () => {
    const client = new FakeCoreApiClient();
    client.getResponses.set(STATUS_PATH, { status: "suspended" });
    const provider = new HttpTenantStatusProvider(client);

    const status = await provider.getStatus("tenant-1");

    expect(status).toBe("suspended");
  });

  /**
   * Same fail-open discipline as HttpCapacityConfigProvider's own core-api
   * calls (see that class's own comment) — a core-api outage on this hot
   * path must never itself become "every call to every tenant gets
   * rejected." A missed suspension during a brief outage is a rare, low-
   * cost gap; blocking every call platform-wide is a far worse regression.
   */
  it("core-api unreachable: fails open to active rather than throwing", async () => {
    const client = new FakeCoreApiClient();
    client.getFailures.set(STATUS_PATH, new Error("ECONNREFUSED"));
    const provider = new HttpTenantStatusProvider(client);

    const status = await provider.getStatus("tenant-1");

    expect(status).toBe("active");
  });
});
