import { StaticTenantRoutingProvider } from "./static-tenant-routing.provider";

describe("StaticTenantRoutingProvider", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("resolves an exact match from TENANT_ROUTING_MAP", async () => {
    process.env["TENANT_ROUTING_MAP"] = JSON.stringify([
      {
        toNumber: "+15559876543",
        tenantId: "tenant-1",
        businessId: "business-1",
        timezone: "America/Chicago",
      },
    ]);
    delete process.env["TENANT_ROUTING_DEFAULT_TENANT_ID"];
    const provider = new StaticTenantRoutingProvider();

    const route = await provider.resolve("+15559876543");

    expect(route).toEqual({
      tenantId: "tenant-1",
      businessId: "business-1",
      timezone: "America/Chicago",
    });
  });

  it("falls back to TENANT_ROUTING_DEFAULT_* when no map entry matches", async () => {
    delete process.env["TENANT_ROUTING_MAP"];
    process.env["TENANT_ROUTING_DEFAULT_TENANT_ID"] = "tenant-default";
    process.env["TENANT_ROUTING_DEFAULT_BUSINESS_ID"] = "business-default";
    const provider = new StaticTenantRoutingProvider();

    const route = await provider.resolve("+15550000000");

    expect(route).toEqual({
      tenantId: "tenant-default",
      businessId: "business-default",
      timezone: undefined,
    });
  });

  it("returns null when neither a map entry nor defaults are configured", async () => {
    delete process.env["TENANT_ROUTING_MAP"];
    delete process.env["TENANT_ROUTING_DEFAULT_TENANT_ID"];
    delete process.env["TENANT_ROUTING_DEFAULT_BUSINESS_ID"];
    const provider = new StaticTenantRoutingProvider();

    const route = await provider.resolve("+15550000000");

    expect(route).toBeNull();
  });

  it("falls back to defaults (rather than throwing) when TENANT_ROUTING_MAP is malformed JSON", async () => {
    process.env["TENANT_ROUTING_MAP"] = "{not valid json";
    process.env["TENANT_ROUTING_DEFAULT_TENANT_ID"] = "tenant-default";
    process.env["TENANT_ROUTING_DEFAULT_BUSINESS_ID"] = "business-default";
    const provider = new StaticTenantRoutingProvider();

    const route = await provider.resolve("+15550000000");

    expect(route).toEqual({
      tenantId: "tenant-default",
      businessId: "business-default",
      timezone: undefined,
    });
  });
});
