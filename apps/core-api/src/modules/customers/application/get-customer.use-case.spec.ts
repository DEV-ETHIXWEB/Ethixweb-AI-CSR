import type { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import { CustomerNotFoundError } from "../domain/errors";
import type { Customer } from "../domain/customer.entity";
import { FakeCustomerRepository } from "./__fakes__/fake-customer-repository";
import { FakeTenantContextService } from "./__fakes__/fake-tenant-context";
import { GetCustomerUseCase } from "./get-customer.use-case";

function makeCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: "customer-1",
    tenantId: "tenant-a",
    businessId: "business-1",
    crmCustomerId: null,
    phoneE164: "+15551234567",
    name: "Jane Doe",
    email: null,
    address: null,
    crmRawCache: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("GetCustomerUseCase", () => {
  it("returns the customer when it belongs to the caller's tenant", async () => {
    const repository = new FakeCustomerRepository();
    repository.seed(makeCustomer());
    const useCase = new GetCustomerUseCase(
      new FakeTenantContextService() as unknown as TenantContextService,
      repository,
    );

    const customer = await useCase.execute("tenant-a", "customer-1");
    expect(customer.name).toBe("Jane Doe");
  });

  it("throws CustomerNotFoundError for a customer that doesn't exist", async () => {
    const useCase = new GetCustomerUseCase(
      new FakeTenantContextService() as unknown as TenantContextService,
      new FakeCustomerRepository(),
    );

    await expect(useCase.execute("tenant-a", "missing")).rejects.toThrow(CustomerNotFoundError);
  });

  it("IDOR defense in depth: a real customer id from a DIFFERENT tenant is never returned", async () => {
    const repository = new FakeCustomerRepository();
    repository.seed(makeCustomer({ tenantId: "tenant-a" }));
    const useCase = new GetCustomerUseCase(
      new FakeTenantContextService() as unknown as TenantContextService,
      repository,
    );

    await expect(useCase.execute("tenant-b", "customer-1")).rejects.toThrow(CustomerNotFoundError);
  });
});
