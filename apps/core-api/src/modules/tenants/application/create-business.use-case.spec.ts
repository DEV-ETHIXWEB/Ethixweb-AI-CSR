import type { PrismaService } from "../../../shared/prisma/prisma.service";
import type { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import { TenantNotFoundError } from "../domain/errors";
import { createNoopLogger } from "./__fakes__/fake-logger";
import { FakeBusinessRepository } from "./__fakes__/fake-business-repository";
import { FakeTenantContextService } from "./__fakes__/fake-tenant-context";
import { FakeTenantRepository } from "./__fakes__/fake-tenant-repository";
import { CreateBusinessUseCase } from "./create-business.use-case";

describe("CreateBusinessUseCase", () => {
  it("creates a business under an existing tenant", async () => {
    const tenantRepository = new FakeTenantRepository();
    tenantRepository.seed({
      id: "tenant-1",
      name: "All Phase Plumbing",
      planTier: "trial",
      status: "trial",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const businessRepository = new FakeBusinessRepository();
    const useCase = new CreateBusinessUseCase(
      {} as PrismaService,
      new FakeTenantContextService() as unknown as TenantContextService,
      tenantRepository,
      businessRepository,
      createNoopLogger(),
    );

    const business = await useCase.execute({
      tenantId: "tenant-1",
      name: "Main Office",
      timezone: "America/Chicago",
      crmType: "housecall_pro",
    });

    expect(business.tenantId).toBe("tenant-1");
    expect(business.name).toBe("Main Office");
    expect(business.crmType).toBe("housecall_pro");
  });

  it("refuses to create a business under a tenant that doesn't exist", async () => {
    const tenantRepository = new FakeTenantRepository();
    const businessRepository = new FakeBusinessRepository();
    const useCase = new CreateBusinessUseCase(
      {} as PrismaService,
      new FakeTenantContextService() as unknown as TenantContextService,
      tenantRepository,
      businessRepository,
      createNoopLogger(),
    );

    await expect(
      useCase.execute({
        tenantId: "does-not-exist",
        name: "Main Office",
        timezone: "America/Chicago",
        crmType: "housecall_pro",
      }),
    ).rejects.toThrow(TenantNotFoundError);
  });
});
