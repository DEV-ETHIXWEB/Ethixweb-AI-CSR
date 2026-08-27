import { CircuitBreakerRegistry } from "@ethixweb/shared-kernel";
import { createNoopLogger } from "../application/__fakes__/fake-logger";
import { UnknownCrmTypeError } from "../domain/errors";
import { FieldEdgeAdapter } from "./adapters/field-edge.adapter";
import { HousecallProAdapter } from "./adapters/housecall-pro.adapter";
import { JobberAdapter } from "./adapters/jobber.adapter";
import { ServiceFusionAdapter } from "./adapters/service-fusion.adapter";
import { ServiceTitanAdapter } from "./adapters/service-titan.adapter";
import { CrmAdapterRegistryImpl } from "./crm-adapter-registry";
import { ResilientCrmAdapter } from "./resilient-crm-adapter";

function buildRegistry(): CrmAdapterRegistryImpl {
  return new CrmAdapterRegistryImpl(
    new HousecallProAdapter(),
    new ServiceTitanAdapter(),
    new JobberAdapter(),
    new ServiceFusionAdapter(),
    new FieldEdgeAdapter(),
    new CircuitBreakerRegistry(),
    createNoopLogger(),
  );
}

describe("CrmAdapterRegistryImpl", () => {
  it("resolves housecall_pro to a resilience-wrapped HousecallProAdapter", () => {
    const registry = buildRegistry();
    const adapter = registry.resolve("housecall_pro", "tenant-1");
    expect(adapter).toBeInstanceOf(ResilientCrmAdapter);
    expect(adapter.crmType).toBe("housecall_pro");
  });

  it.each(["service_titan", "jobber", "service_fusion", "field_edge"])(
    "resolves the %s stub adapter",
    (crmType) => {
      const registry = buildRegistry();
      expect(registry.resolve(crmType, "tenant-1").crmType).toBe(crmType);
    },
  );

  it("throws UnknownCrmTypeError for an unregistered crmType", () => {
    const registry = buildRegistry();
    expect(() => registry.resolve("not_a_real_crm", "tenant-1")).toThrow(UnknownCrmTypeError);
  });

  it("gives the same crmType two different tenants independently-keyed circuit breakers", () => {
    const registry = buildRegistry();
    // Calling resolve() twice for different tenants must not throw or
    // collide — each gets its own CircuitBreakerRegistry entry keyed
    // `crm:${crmType}:${tenantId}` (see the port's own comment on why).
    const adapterForTenantA = registry.resolve("housecall_pro", "tenant-a");
    const adapterForTenantB = registry.resolve("housecall_pro", "tenant-b");
    expect(adapterForTenantA).not.toBe(adapterForTenantB);
  });

  it(
    "REGRESSION: resolved adapters use a tight retry budget (2 attempts), not shared-kernel's " +
      "platform-wide 6-attempt/~31s-backoff default — found live: a synchronous createLead call " +
      "against an unreachable CRM took 32.4s to fall back to a local-only lead with the default " +
      "policy, directly contradicting CreateLeadUseCase's own 'never blocks the conversation' " +
      "contract. Asserted via attempt count (deterministic), not elapsed time (flaky in CI).",
    async () => {
      const registry = buildRegistry();
      const adapter = registry.resolve("housecall_pro", "tenant-1");
      let attempts = 0;
      jest.spyOn(HousecallProAdapter.prototype, "testConnection").mockImplementation(async () => {
        attempts += 1;
        throw new Error("simulated unreachable CRM");
      });

      await expect(
        adapter.testConnection({ type: "api_key", apiKey: "irrelevant" }),
      ).rejects.toThrow();

      expect(attempts).toBe(2);
    },
  );
});
