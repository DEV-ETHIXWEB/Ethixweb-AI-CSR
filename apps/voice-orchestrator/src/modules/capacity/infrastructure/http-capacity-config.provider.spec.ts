import {
  DEFAULT_BROCHURE_ROTATION_INTERVAL_MS,
  DEFAULT_EMERGENCY_HEADROOM_RATIO,
  DEFAULT_MAX_TENANT_CONCURRENT_CALLS,
  DEFAULT_MAX_WAITING_CALLERS,
  DEFAULT_WAITING_TIMEOUT_MS,
} from "./static-capacity-config.provider";
import { FakeCoreApiClient } from "./__fakes__/fake-core-api-client";
import { HttpCapacityConfigProvider } from "./http-capacity-config.provider";

const CAPACITY_PATH = "/internal/capacity-config/business-1";
const BROCHURE_PATH = "/internal/knowledge/business-1/waiting-brochure";

describe("HttpCapacityConfigProvider", () => {
  it("happy path: maps a full core-api capacity-config + brochure response into CapacityConfig", async () => {
    const client = new FakeCoreApiClient();
    client.getResponses.set(CAPACITY_PATH, {
      maxTenantConcurrentCalls: 25,
      maxWaitingCallers: 8,
      waitingTimeoutMs: 45000,
      emergencyHeadroomRatio: 0.3,
      overflowNumber: "+15551234567",
      brochureEnabled: true,
      brochureRotationMs: 20000,
    });
    client.getResponses.set(BROCHURE_PATH, [
      { id: "item-1", text: "We're licensed and insured." },
      { id: "item-2", text: "Same-day appointments available." },
    ]);
    const provider = new HttpCapacityConfigProvider(client);

    const config = await provider.getActiveConfig("tenant-1", "business-1");

    expect(config.tenantId).toBe("tenant-1");
    expect(config.businessId).toBe("business-1");
    expect(config.maxTenantConcurrentCalls).toBe(25);
    expect(config.maxWaitingCallers).toBe(8);
    expect(config.waitingTimeoutMs).toBe(45000);
    expect(config.emergencyHeadroomRatio).toBe(0.3);
    expect(config.overflowNumber).toBe("+15551234567");
    expect(config.brochure.enabled).toBe(true);
    expect(config.brochure.segments).toEqual([
      { id: "item-1", text: "We're licensed and insured." },
      { id: "item-2", text: "Same-day appointments available." },
    ]);
    expect(typeof config.maxGlobalConcurrentCalls).toBe("number");
  });

  it("core-api unreachable on BOTH calls: falls back to exact StaticCapacityConfigProvider default values, never throwing", async () => {
    const client = new FakeCoreApiClient();
    client.getFailures.set(CAPACITY_PATH, new Error("ECONNREFUSED"));
    client.getFailures.set(BROCHURE_PATH, new Error("ECONNREFUSED"));
    const provider = new HttpCapacityConfigProvider(client);

    const config = await provider.getActiveConfig("tenant-1", "business-1");

    expect(config.maxTenantConcurrentCalls).toBe(DEFAULT_MAX_TENANT_CONCURRENT_CALLS);
    expect(config.maxWaitingCallers).toBe(DEFAULT_MAX_WAITING_CALLERS);
    expect(config.waitingTimeoutMs).toBe(DEFAULT_WAITING_TIMEOUT_MS);
    expect(config.emergencyHeadroomRatio).toBe(DEFAULT_EMERGENCY_HEADROOM_RATIO);
    expect(config.overflowNumber).toBeNull();
    expect(config.brochure).toEqual({
      enabled: false,
      businessName: "the office",
      segments: [],
      rotationIntervalMs: DEFAULT_BROCHURE_ROTATION_INTERVAL_MS,
    });
  });

  it("missing/partial optional response fields fill sensible defaults instead of undefined/crashing", async () => {
    const client = new FakeCoreApiClient();
    // overflowNumber, brochureRotationMs, waitingTimeoutMs all absent.
    client.getResponses.set(CAPACITY_PATH, {
      maxTenantConcurrentCalls: 15,
      maxWaitingCallers: 3,
      emergencyHeadroomRatio: 0.1,
      brochureEnabled: false,
    });
    client.getResponses.set(BROCHURE_PATH, []);
    const provider = new HttpCapacityConfigProvider(client);

    const config = await provider.getActiveConfig("tenant-1", "business-1");

    expect(config.maxTenantConcurrentCalls).toBe(15);
    expect(config.waitingTimeoutMs).toBe(DEFAULT_WAITING_TIMEOUT_MS);
    expect(config.overflowNumber).toBeNull();
    expect(config.brochure.segments).toEqual([]);
  });

  it("brochure fetch fails independently: real capacity-config values are used with a default/empty brochure, NOT a full fallback", async () => {
    const client = new FakeCoreApiClient();
    client.getResponses.set(CAPACITY_PATH, {
      maxTenantConcurrentCalls: 42,
      maxWaitingCallers: 9,
      waitingTimeoutMs: 60000,
      emergencyHeadroomRatio: 0.4,
      overflowNumber: "+15559998888",
      brochureEnabled: true,
      brochureRotationMs: 10000,
    });
    client.getFailures.set(BROCHURE_PATH, new Error("core-api 500"));
    const provider = new HttpCapacityConfigProvider(client);

    const config = await provider.getActiveConfig("tenant-1", "business-1");

    // The real capacity-config values survived — NOT overwritten by the
    // brochure failure.
    expect(config.maxTenantConcurrentCalls).toBe(42);
    expect(config.maxWaitingCallers).toBe(9);
    expect(config.waitingTimeoutMs).toBe(60000);
    expect(config.emergencyHeadroomRatio).toBe(0.4);
    expect(config.overflowNumber).toBe("+15559998888");
    // Only the brochure degraded.
    expect(config.brochure.segments).toEqual([]);
    expect(config.brochure.enabled).toBe(false);
  });

  it("capacity-config fetch fails but brochure succeeds: capacity falls back to defaults independently of the successful brochure fetch", async () => {
    const client = new FakeCoreApiClient();
    client.getFailures.set(CAPACITY_PATH, new Error("core-api 500"));
    client.getResponses.set(BROCHURE_PATH, [{ id: "item-1", text: "Welcome!" }]);
    const provider = new HttpCapacityConfigProvider(client);

    const config = await provider.getActiveConfig("tenant-1", "business-1");

    expect(config.maxTenantConcurrentCalls).toBe(DEFAULT_MAX_TENANT_CONCURRENT_CALLS);
    // brochureEnabled defaults to false on a capacity-config fetch failure,
    // so the (independently successful) segments are fetched but the
    // brochure stays disabled overall — enabled is driven by the capacity
    // config, not by the brochure fetch succeeding.
    expect(config.brochure.enabled).toBe(false);
    expect(config.brochure.segments).toEqual([{ id: "item-1", text: "Welcome!" }]);
  });
});
