import type { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import { FakeBusinessRepository } from "./__fakes__/fake-business-repository";
import { FakeTenantContextService } from "./__fakes__/fake-tenant-context";
import { ListBusinessesUseCase } from "./list-businesses.use-case";

describe("ListBusinessesUseCase", () => {
  it("returns only the caller's own tenant's businesses", async () => {
    const businessRepository = new FakeBusinessRepository();
    businessRepository.seed({
      id: "business-1",
      tenantId: "tenant-a",
      name: "Tenant A Office 1",
      timezone: "America/Chicago",
      crmType: "housecall_pro",
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    businessRepository.seed({
      id: "business-2",
      tenantId: "tenant-a",
      name: "Tenant A Office 2",
      timezone: "America/Chicago",
      crmType: "housecall_pro",
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    businessRepository.seed({
      id: "business-3",
      tenantId: "tenant-b",
      name: "Tenant B Office",
      timezone: "America/New_York",
      crmType: "housecall_pro",
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const useCase = new ListBusinessesUseCase(
      new FakeTenantContextService() as unknown as TenantContextService,
      businessRepository,
    );

    const businesses = await useCase.execute("tenant-a");

    expect(businesses).toHaveLength(2);
    expect(businesses.every((business) => business.tenantId === "tenant-a")).toBe(true);
  });

  it("returns an empty array for a tenant with no businesses", async () => {
    const useCase = new ListBusinessesUseCase(
      new FakeTenantContextService() as unknown as TenantContextService,
      new FakeBusinessRepository(),
    );

    const businesses = await useCase.execute("tenant-with-none");
    expect(businesses).toEqual([]);
  });
});
