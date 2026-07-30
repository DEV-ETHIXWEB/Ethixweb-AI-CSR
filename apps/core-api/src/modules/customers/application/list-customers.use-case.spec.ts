import type { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import type { Customer } from "../domain/customer.entity";
import { FakeCustomerRepository } from "./__fakes__/fake-customer-repository";
import { FakeTenantContextService } from "./__fakes__/fake-tenant-context";
import { ListCustomersUseCase } from "./list-customers.use-case";

function makeCustomer(overrides: Partial<Customer>): Customer {
  return {
    id: "customer-x",
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

describe("ListCustomersUseCase", () => {
  it("returns only customers for the given tenant and business, with a total count", async () => {
    const repository = new FakeCustomerRepository();
    repository.seed(
      makeCustomer({ id: "c1", tenantId: "tenant-a", businessId: "biz-1", name: "Alice" }),
    );
    repository.seed(
      makeCustomer({ id: "c2", tenantId: "tenant-a", businessId: "biz-1", name: "Bob" }),
    );
    repository.seed(
      makeCustomer({ id: "c3", tenantId: "tenant-a", businessId: "biz-2", name: "Carol" }),
    );
    repository.seed(
      makeCustomer({ id: "c4", tenantId: "tenant-b", businessId: "biz-1", name: "Dave" }),
    );
    const useCase = new ListCustomersUseCase(
      new FakeTenantContextService() as unknown as TenantContextService,
      repository,
    );

    const result = await useCase.execute({
      tenantId: "tenant-a",
      businessId: "biz-1",
      page: 1,
      pageSize: 20,
    });

    expect(result.total).toBe(2);
    expect(result.items.map((c) => c.name).sort()).toEqual(["Alice", "Bob"]);
  });

  it("paginates correctly", async () => {
    const repository = new FakeCustomerRepository();
    for (let i = 0; i < 5; i++) {
      repository.seed(
        makeCustomer({ id: `c${i}`, name: `Customer ${i}`, phoneE164: `+1555000000${i}` }),
      );
    }
    const useCase = new ListCustomersUseCase(
      new FakeTenantContextService() as unknown as TenantContextService,
      repository,
    );

    const page1 = await useCase.execute({
      tenantId: "tenant-a",
      businessId: "business-1",
      page: 1,
      pageSize: 2,
    });
    const page2 = await useCase.execute({
      tenantId: "tenant-a",
      businessId: "business-1",
      page: 2,
      pageSize: 2,
    });

    expect(page1.items).toHaveLength(2);
    expect(page2.items).toHaveLength(2);
    expect(page1.total).toBe(5);
    expect(page1.items[0]?.id).not.toBe(page2.items[0]?.id);
  });

  it("filters by search text against name or phone", async () => {
    const repository = new FakeCustomerRepository();
    repository.seed(makeCustomer({ id: "c1", name: "Alice Anderson", phoneE164: "+15551110000" }));
    repository.seed(makeCustomer({ id: "c2", name: "Bob Brown", phoneE164: "+15552220000" }));
    const useCase = new ListCustomersUseCase(
      new FakeTenantContextService() as unknown as TenantContextService,
      repository,
    );

    const result = await useCase.execute({
      tenantId: "tenant-a",
      businessId: "business-1",
      page: 1,
      pageSize: 20,
      search: "alice",
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.name).toBe("Alice Anderson");
  });
});
