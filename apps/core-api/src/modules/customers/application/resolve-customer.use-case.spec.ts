import type { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import { NoCrmIntegrationConfiguredError } from "../domain/errors";
import type { Customer } from "../domain/customer.entity";
import { createNoopLogger } from "./__fakes__/fake-logger";
import { FakeCrmCustomerSyncPort } from "./__fakes__/fake-crm-customer-sync-port";
import { FakeCustomerRepository } from "./__fakes__/fake-customer-repository";
import { FakeOutboxWriterFactory } from "./__fakes__/fake-outbox-writer-factory";
import { FakeTenantContextService } from "./__fakes__/fake-tenant-context";
import { CustomerCacheUpserter } from "./customer-cache-upserter";
import { ResolveCustomerUseCase } from "./resolve-customer.use-case";

function buildUseCase(
  customerRepository = new FakeCustomerRepository(),
  crmCustomerSyncPort = new FakeCrmCustomerSyncPort(),
  outboxWriterFactory = new FakeOutboxWriterFactory(),
) {
  return new ResolveCustomerUseCase(
    new FakeTenantContextService() as unknown as TenantContextService,
    customerRepository,
    crmCustomerSyncPort,
    outboxWriterFactory,
    new CustomerCacheUpserter(customerRepository),
    createNoopLogger(),
  );
}

function seedFreshCustomer(repository: FakeCustomerRepository): Customer {
  const customer: Customer = {
    id: "customer-1",
    tenantId: "tenant-1",
    businessId: "business-1",
    crmCustomerId: "crm-customer-1",
    phoneE164: "+15551234567",
    name: "Jane Doe",
    email: null,
    address: null,
    crmRawCache: null,
    createdAt: new Date(),
    updatedAt: new Date(), // fresh — "now"
  };
  repository.seed(customer);
  return customer;
}

describe("ResolveCustomerUseCase", () => {
  it("returns the local cache row directly when it's fresh — never calls the CRM", async () => {
    const customerRepository = new FakeCustomerRepository();
    seedFreshCustomer(customerRepository);
    const crmCustomerSyncPort = new FakeCrmCustomerSyncPort();
    const searchSpy = jest.spyOn(crmCustomerSyncPort, "searchCustomer");
    const useCase = buildUseCase(customerRepository, crmCustomerSyncPort);

    const result = await useCase.execute({
      tenantId: "tenant-1",
      businessId: "business-1",
      phoneE164: "+15551234567",
    });

    expect(result?.id).toBe("customer-1");
    expect(searchSpy).not.toHaveBeenCalled();
  });

  it("on a cache miss, searches the CRM and writes back a new local cache row", async () => {
    const customerRepository = new FakeCustomerRepository();
    const crmCustomerSyncPort = new FakeCrmCustomerSyncPort();
    crmCustomerSyncPort.searchResults.set("+15551234567", {
      crmCustomerId: "crm-customer-99",
      name: "Jane Doe",
      phoneE164: "+15551234567",
      raw: {},
    });
    const outboxWriterFactory = new FakeOutboxWriterFactory();
    const useCase = buildUseCase(customerRepository, crmCustomerSyncPort, outboxWriterFactory);

    const result = await useCase.execute({
      tenantId: "tenant-1",
      businessId: "business-1",
      phoneE164: "+15551234567",
    });

    expect(result?.crmCustomerId).toBe("crm-customer-99");
    expect(outboxWriterFactory.writtenEvents).toHaveLength(1);
  });

  it("returns null (not an error) when neither the local cache nor the CRM has a match", async () => {
    const useCase = buildUseCase();

    const result = await useCase.execute({
      tenantId: "tenant-1",
      businessId: "business-1",
      phoneE164: "+15559999999",
    });

    expect(result).toBeNull();
  });

  it("refreshes a STALE cache row from the CRM instead of returning it as-is", async () => {
    const customerRepository = new FakeCustomerRepository();
    const stale = seedFreshCustomer(customerRepository);
    stale.updatedAt = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago — well past the TTL
    const crmCustomerSyncPort = new FakeCrmCustomerSyncPort();
    crmCustomerSyncPort.searchResults.set("+15551234567", {
      crmCustomerId: "crm-customer-1",
      name: "Jane Doe (updated)",
      phoneE164: "+15551234567",
      raw: {},
    });
    const useCase = buildUseCase(customerRepository, crmCustomerSyncPort);

    const result = await useCase.execute({
      tenantId: "tenant-1",
      businessId: "business-1",
      phoneE164: "+15551234567",
    });

    expect(result?.name).toBe("Jane Doe (updated)");
  });

  it("throws NoCrmIntegrationConfiguredError on a genuine cache miss with no CRM connected", async () => {
    const crmCustomerSyncPort = new FakeCrmCustomerSyncPort();
    crmCustomerSyncPort.activeIntegrationId = null;
    const useCase = buildUseCase(new FakeCustomerRepository(), crmCustomerSyncPort);

    await expect(
      useCase.execute({
        tenantId: "tenant-1",
        businessId: "business-1",
        phoneE164: "+15551234567",
      }),
    ).rejects.toThrow(NoCrmIntegrationConfiguredError);
  });

  it("returns stale cached data rather than erroring when there's no CRM to refresh against", async () => {
    const customerRepository = new FakeCustomerRepository();
    const stale = seedFreshCustomer(customerRepository);
    stale.updatedAt = new Date(Date.now() - 60 * 60 * 1000);
    const crmCustomerSyncPort = new FakeCrmCustomerSyncPort();
    crmCustomerSyncPort.activeIntegrationId = null;
    const useCase = buildUseCase(customerRepository, crmCustomerSyncPort);

    const result = await useCase.execute({
      tenantId: "tenant-1",
      businessId: "business-1",
      phoneE164: "+15551234567",
    });

    expect(result?.id).toBe("customer-1"); // stale data, but still returned
  });
});
