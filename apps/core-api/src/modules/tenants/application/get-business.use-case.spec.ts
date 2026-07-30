import type { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import { BusinessNotFoundError } from "../domain/errors";
import { FakeBusinessRepository } from "./__fakes__/fake-business-repository";
import { FakeTenantContextService } from "./__fakes__/fake-tenant-context";
import { GetBusinessUseCase } from "./get-business.use-case";

describe("GetBusinessUseCase", () => {
  it("returns the business when it belongs to the caller's tenant", async () => {
    const businessRepository = new FakeBusinessRepository();
    businessRepository.seed({
      id: "business-1",
      tenantId: "tenant-1",
      name: "Main Office",
      timezone: "America/Chicago",
      crmType: "housecall_pro",
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const useCase = new GetBusinessUseCase(
      new FakeTenantContextService() as unknown as TenantContextService,
      businessRepository,
    );

    const business = await useCase.execute("tenant-1", "business-1");
    expect(business.name).toBe("Main Office");
  });

  it("throws BusinessNotFoundError for a business that doesn't exist", async () => {
    const useCase = new GetBusinessUseCase(
      new FakeTenantContextService() as unknown as TenantContextService,
      new FakeBusinessRepository(),
    );

    await expect(useCase.execute("tenant-1", "missing")).rejects.toThrow(BusinessNotFoundError);
  });

  it("IDOR defense in depth: a real business id from a DIFFERENT tenant is never returned", async () => {
    const businessRepository = new FakeBusinessRepository();
    businessRepository.seed({
      id: "business-1",
      tenantId: "tenant-a",
      name: "Tenant A's Office",
      timezone: "America/Chicago",
      crmType: "housecall_pro",
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const useCase = new GetBusinessUseCase(
      new FakeTenantContextService() as unknown as TenantContextService,
      businessRepository,
    );

    // "tenant-b" and "business-1" would never both come from one real,
    // JWT-verified principal — this simulates the RLS-bypass/programmer-
    // error case BusinessRepository.findById's own tenantId parameter
    // exists to defend against.
    await expect(useCase.execute("tenant-b", "business-1")).rejects.toThrow(BusinessNotFoundError);
  });
});
