import type { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import { NoCrmIntegrationConfiguredError } from "../domain/errors";
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

  it("throws NoCrmIntegrationConfiguredError when the business has no active integration", async () => {
    const crmCustomerSyncPort = new FakeCrmCustomerSyncPort();
    crmCustomerSyncPort.activeIntegrationId = null;
    const useCase = buildUseCase(new FakeCustomerRepository(), crmCustomerSyncPort);

    await expect(
      useCase.execute({
        tenantId: "tenant-1",
        businessId: "business-1",
        name: "Jane Doe",
        phoneE164: "+15551234567",
      }),
    ).rejects.toThrow(NoCrmIntegrationConfiguredError);
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
});
