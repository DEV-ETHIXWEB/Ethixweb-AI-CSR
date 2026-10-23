import type { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import { createNoopLogger } from "./__fakes__/fake-logger";
import { FakeCrmCustomerSyncPort } from "./__fakes__/fake-crm-customer-sync-port";
import { FakeCustomerRepository } from "./__fakes__/fake-customer-repository";
import { FakeOutboxWriterFactory } from "./__fakes__/fake-outbox-writer-factory";
import { FakeTenantContextService } from "./__fakes__/fake-tenant-context";
import { CreateCustomerUseCase } from "./create-customer.use-case";
import { CustomerCacheUpserter } from "./customer-cache-upserter";

function buildUseCase(
  customerRepository = new FakeCustomerRepository(),
  crmCustomerSyncPort = new FakeCrmCustomerSyncPort(),
  outboxWriterFactory = new FakeOutboxWriterFactory(),
) {
  return new CreateCustomerUseCase(
    new FakeTenantContextService() as unknown as TenantContextService,
    crmCustomerSyncPort,
    outboxWriterFactory,
    new CustomerCacheUpserter(customerRepository),
    createNoopLogger(),
    customerRepository,
  );
}

describe("CreateCustomerUseCase", () => {
  it("creates the customer in the CRM, caches it locally, and publishes a customer.created outbox event", async () => {
    const outboxWriterFactory = new FakeOutboxWriterFactory();
    const useCase = buildUseCase(
      new FakeCustomerRepository(),
      new FakeCrmCustomerSyncPort(),
      outboxWriterFactory,
    );

    const customer = await useCase.execute({
      tenantId: "tenant-1",
      businessId: "business-1",
      name: "Jane Doe",
      phoneE164: "+15551234567",
      email: "jane@example.com",
    });

    expect(customer.name).toBe("Jane Doe");
    expect(customer.crmCustomerId).toBeTruthy();
    expect(outboxWriterFactory.writtenEvents).toHaveLength(1);
    expect(outboxWriterFactory.writtenEvents[0]?.eventType).toBe("customer.created");
  });

  it("creates a local-only customer (crmCustomerId null) when the business has no active integration — never blocks on a missing CRM", async () => {
    const crmCustomerSyncPort = new FakeCrmCustomerSyncPort();
    crmCustomerSyncPort.activeIntegrationId = null;
    const outboxWriterFactory = new FakeOutboxWriterFactory();
    const useCase = buildUseCase(
      new FakeCustomerRepository(),
      crmCustomerSyncPort,
      outboxWriterFactory,
    );

    const customer = await useCase.execute({
      tenantId: "tenant-1",
      businessId: "business-1",
      name: "Jane Doe",
      phoneE164: "+15551234567",
    });

    expect(customer.crmCustomerId).toBeNull();
    expect(customer.name).toBe("Jane Doe");
    expect(customer.phoneE164).toBe("+15551234567");
    expect(outboxWriterFactory.writtenEvents).toHaveLength(1);
    expect(outboxWriterFactory.writtenEvents[0]?.eventType).toBe("customer.created");
  });

  it(
    "CONCURRENCY: two simultaneous createCustomer calls for the SAME phone number both " +
      "succeed with the SAME local customer row, never a duplicate or an error " +
      "(docs/13 customers module §5's explicit test requirement)",
    async () => {
      const customerRepository = new FakeCustomerRepository();
      const outboxWriterFactory = new FakeOutboxWriterFactory();
      const useCase = buildUseCase(
        customerRepository,
        new FakeCrmCustomerSyncPort(),
        outboxWriterFactory,
      );
      const command = {
        tenantId: "tenant-1",
        businessId: "business-1",
        name: "Jane Doe",
        phoneE164: "+15551234567",
      };

      const [first, second] = await Promise.all([
        useCase.execute(command),
        useCase.execute(command),
      ]);

      expect(first.id).toBe(second.id);
      // Only whichever call actually created the row published an event —
      // never two events for what is, locally, a single customer.
      expect(outboxWriterFactory.writtenEvents).toHaveLength(1);
      const { items } = await customerRepository.listByBusiness(
        undefined as never,
        "tenant-1",
        "business-1",
        { page: 1, pageSize: 10 },
      );
      expect(items).toHaveLength(1);
    },
  );

  it("CLIENT FEEDBACK (2026-10-13): a number that already had an incomplete row gets the name and address the caller just confirmed, instead of the old row coming back unchanged", async () => {
    const customerRepository = new FakeCustomerRepository();
    const useCase = buildUseCase(customerRepository);
    const base = { tenantId: "tenant-1", businessId: "business-1", phoneE164: "+18722784999" };
    const earlier = await useCase.execute({ ...base, name: "unknown" });

    const later = await useCase.execute({
      ...base,
      name: "Patrick Lee",
      address: { street: "1912 9th Ave W", city: "Seattle", state: "WA", zip: "98119" },
    });

    expect(later.id).toBe(earlier.id);
    expect(later.name).toBe("Patrick Lee");
    expect(later.address).toEqual({
      street: "1912 9th Ave W",
      city: "Seattle",
      state: "WA",
      zip: "98119",
    });
    const stored = await customerRepository.findById(undefined as never, "tenant-1", earlier.id);
    expect(stored?.name).toBe("Patrick Lee");
  });

  it("keeps a stored address when a later save for the same number has none", async () => {
    const customerRepository = new FakeCustomerRepository();
    const useCase = buildUseCase(customerRepository);
    const base = { tenantId: "tenant-1", businessId: "business-1", phoneE164: "+18722784999" };
    await useCase.execute({ ...base, name: "Patrick Lee", address: { street: "1912 9th Ave W" } });

    const later = await useCase.execute({ ...base, name: "Patrick Lee" });

    expect(later.address).toEqual({ street: "1912 9th Ave W" });
  });

  it("2026-10-23: a different caller on the same number saved without an address does not inherit the last one's", async () => {
    const customerRepository = new FakeCustomerRepository();
    const useCase = buildUseCase(customerRepository);
    const base = { tenantId: "tenant-1", businessId: "business-1", phoneE164: "+18722784999" };
    await useCase.execute({
      ...base,
      name: "Nora Kessler",
      address: { street: "1748 westlake avenue unit 412", zip: "98121" },
    });

    const later = await useCase.execute({ ...base, name: "Omar Hadad" });

    expect(later.name).toBe("Omar Hadad");
    expect(later.address).toBeNull();
  });
});
