import type { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import { BusinessNotFoundError } from "../domain/errors";
import { createNoopLogger } from "./__fakes__/fake-logger";
import { FakeBusinessRepository } from "./__fakes__/fake-business-repository";
import { FakeTenantContextService } from "./__fakes__/fake-tenant-context";
import { UpdateBusinessUseCase } from "./update-business.use-case";

describe("UpdateBusinessUseCase", () => {
  function seedBusiness(repository: FakeBusinessRepository) {
    repository.seed({
      id: "business-1",
      tenantId: "tenant-1",
      name: "Main Office",
      timezone: "America/Chicago",
      crmType: "housecall_pro",
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  it("renames a business and updates its timezone", async () => {
    const businessRepository = new FakeBusinessRepository();
    seedBusiness(businessRepository);
    const useCase = new UpdateBusinessUseCase(
      new FakeTenantContextService() as unknown as TenantContextService,
      businessRepository,
      createNoopLogger(),
    );

    const updated = await useCase.execute("tenant-1", "business-1", {
      name: "Downtown Office",
      timezone: "America/New_York",
    });

    expect(updated.name).toBe("Downtown Office");
    expect(updated.timezone).toBe("America/New_York");
  });

  it("does not change crmType — this use-case has no way to accept it", async () => {
    const businessRepository = new FakeBusinessRepository();
    seedBusiness(businessRepository);
    const useCase = new UpdateBusinessUseCase(
      new FakeTenantContextService() as unknown as TenantContextService,
      businessRepository,
      createNoopLogger(),
    );

    const updated = await useCase.execute("tenant-1", "business-1", {
      name: "Downtown Office",
      timezone: "America/New_York",
    });

    expect(updated.crmType).toBe("housecall_pro");
  });

  it("throws BusinessNotFoundError for a business that doesn't exist", async () => {
    const useCase = new UpdateBusinessUseCase(
      new FakeTenantContextService() as unknown as TenantContextService,
      new FakeBusinessRepository(),
      createNoopLogger(),
    );

    await expect(
      useCase.execute("tenant-1", "missing", { name: "X", timezone: "America/Chicago" }),
    ).rejects.toThrow(BusinessNotFoundError);
  });

  it("IDOR defense in depth: cannot update a business belonging to a different tenant", async () => {
    const businessRepository = new FakeBusinessRepository();
    seedBusiness(businessRepository);
    const useCase = new UpdateBusinessUseCase(
      new FakeTenantContextService() as unknown as TenantContextService,
      businessRepository,
      createNoopLogger(),
    );

    await expect(
      useCase.execute("tenant-b", "business-1", { name: "Hijacked", timezone: "UTC" }),
    ).rejects.toThrow(BusinessNotFoundError);
  });
});
