import { CrmAdapterNotImplementedError } from "../../domain/errors";
import type { CRMAdapter } from "../../domain/ports/crm-adapter.port";
import { FieldEdgeAdapter } from "./field-edge.adapter";
import { JobberAdapter } from "./jobber.adapter";
import { ServiceFusionAdapter } from "./service-fusion.adapter";
import { ServiceTitanAdapter } from "./service-titan.adapter";

const FAKE_CREDENTIAL = { type: "api_key" as const, apiKey: "x" };

describe.each<[string, CRMAdapter]>([
  ["ServiceTitanAdapter", new ServiceTitanAdapter()],
  ["JobberAdapter", new JobberAdapter()],
  ["ServiceFusionAdapter", new ServiceFusionAdapter()],
  ["FieldEdgeAdapter", new FieldEdgeAdapter()],
])("%s (docs/13 crm-integration module §7 stub)", (_name, adapter) => {
  it("exposes its own crmType", () => {
    expect(adapter.crmType).toBeTruthy();
  });

  it("every CRMAdapter method throws CrmAdapterNotImplementedError, never silently no-ops", async () => {
    await expect(
      adapter.searchCustomerByPhone(FAKE_CREDENTIAL, { phoneE164: "+15551234567" }),
    ).rejects.toThrow(CrmAdapterNotImplementedError);
    await expect(
      adapter.createCustomer(FAKE_CREDENTIAL, { name: "x", phoneE164: "+15551234567" }),
    ).rejects.toThrow(CrmAdapterNotImplementedError);
    await expect(
      adapter.createLead(FAKE_CREDENTIAL, {
        crmCustomerId: "x",
        problemSummary: "x",
        priority: "normal",
        leadType: "service_call",
      }),
    ).rejects.toThrow(CrmAdapterNotImplementedError);
    await expect(adapter.updateLead(FAKE_CREDENTIAL, "lead-1", {})).rejects.toThrow(
      CrmAdapterNotImplementedError,
    );
    await expect(adapter.attachNote(FAKE_CREDENTIAL, "entity-1", "note")).rejects.toThrow(
      CrmAdapterNotImplementedError,
    );
    await expect(adapter.testConnection(FAKE_CREDENTIAL)).rejects.toThrow(
      CrmAdapterNotImplementedError,
    );
    expect(() => adapter.verifyWebhookSignature({}, "{}", "secret")).toThrow(
      CrmAdapterNotImplementedError,
    );
    expect(() => adapter.parseWebhookEvent("{}")).toThrow(CrmAdapterNotImplementedError);
  });
});
