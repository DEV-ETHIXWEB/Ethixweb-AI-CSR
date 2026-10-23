import type { GetCallUseCase } from "../../calls/application/get-call.use-case";
import type { Customer } from "../../customers/domain/customer.entity";
import { buildNotificationPayload } from "../../notifications/domain/notification-payload";
import type { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import { createNoopLogger } from "./__fakes__/fake-logger";
import { FakeCrmLeadSyncPort } from "./__fakes__/fake-crm-lead-sync-port";
import { FakeCustomerLookupPort } from "./__fakes__/fake-customer-lookup-port";
import { FakeGetCallUseCase } from "./__fakes__/fake-get-call-use-case";
import { FakeLeadRepository } from "./__fakes__/fake-lead-repository";
import { FakeOutboxWriterFactory } from "./__fakes__/fake-outbox-writer-factory";
import { FakeTenantContextService } from "./__fakes__/fake-tenant-context";
import { CreateLeadUseCase } from "./create-lead.use-case";
import { RefreshLeadCallerUseCase } from "./refresh-lead-caller.use-case";

/**
 * 2026-10-23 client calls: three callers on one number, one shared customer
 * row, and the emergency lead from the first call ended up showing the third
 * caller's name and street.
 */
describe("each lead keeps the caller it was saved for", () => {
  const firstCaller = {
    id: "customer-1",
    tenantId: "tenant-1",
    businessId: "business-1",
    crmCustomerId: null,
    name: "Also Emergency",
    address: { street: "1748 northwest sixtieth street", zip: "98107" },
  };

  function setup() {
    const leads = new FakeLeadRepository();
    const customers = new FakeCustomerLookupPort();
    const calls = new FakeGetCallUseCase();
    customers.seed(firstCaller);
    const tenant = new FakeTenantContextService() as unknown as TenantContextService;
    const createLead = new CreateLeadUseCase(
      tenant,
      leads,
      customers,
      new FakeCrmLeadSyncPort(),
      new FakeOutboxWriterFactory(),
      calls as unknown as GetCallUseCase,
      createNoopLogger(),
    );
    const refresh = new RefreshLeadCallerUseCase(
      tenant,
      leads,
      customers,
      calls as unknown as GetCallUseCase,
    );
    return { leads, customers, createLead, refresh };
  }

  const command = {
    tenantId: "tenant-1",
    businessId: "business-1",
    customerId: "customer-1",
    callId: "call-1",
    problemSummary: "Water heater died, burning smell",
    priority: "emergency",
    leadType: "residential",
  };

  it("copies the caller's name and address onto the lead when it is saved", async () => {
    const { createLead } = setup();
    const lead = await createLead.execute(command);
    expect(lead.qualificationData["caller"]).toEqual({
      name: "Also Emergency",
      address: firstCaller.address,
    });
  });

  it("the notification uses the lead's own caller, not the shared row a later caller overwrote", async () => {
    const { createLead } = setup();
    const lead = await createLead.execute(command);
    const overwritten = {
      name: "Trevor Lindquist",
      phoneE164: "+18722784999",
      address: { street: "9014 rainier avenue", zip: "98118" },
    } as unknown as Customer;
    const payload = buildNotificationPayload(lead, overwritten);
    expect(payload.customerName).toBe("Also Emergency");
    expect(payload.address).toContain("1748 northwest sixtieth street");
  });

  it("refreshes this call's lead after a name correction", async () => {
    const { createLead, customers, refresh } = setup();
    await createLead.execute(command);
    customers.seed({ ...firstCaller, name: "Trevor Lindquist" });
    const lead = await refresh.execute({
      tenantId: "tenant-1",
      businessId: "business-1",
      callId: "call-1",
    });
    expect((lead!.qualificationData["caller"] as { name: string }).name).toBe("Trevor Lindquist");
  });

  it("does nothing for a call that has saved no lead", async () => {
    const { refresh } = setup();
    await expect(
      refresh.execute({ tenantId: "tenant-1", businessId: "business-1", callId: "call-1" }),
    ).resolves.toBeNull();
    await expect(
      refresh.execute({ tenantId: "tenant-1", businessId: "business-1", callId: "no-such-call" }),
    ).resolves.toBeNull();
  });

  it("never touches a lead from another business", async () => {
    const { createLead, refresh } = setup();
    await createLead.execute(command);
    await expect(
      refresh.execute({ tenantId: "tenant-1", businessId: "business-2", callId: "call-1" }),
    ).resolves.toBeNull();
  });
});
