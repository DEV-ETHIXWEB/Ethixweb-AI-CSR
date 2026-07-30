import type { PrismaService } from "../../../shared/prisma/prisma.service";
import { TenantNotFoundError } from "../domain/errors";
import { FakeTenantRepository } from "./__fakes__/fake-tenant-repository";
import { GetTenantUseCase } from "./get-tenant.use-case";

describe("GetTenantUseCase", () => {
  it("returns the tenant when it exists", async () => {
    const repository = new FakeTenantRepository();
    const seeded = {
      id: "tenant-1",
      name: "All Phase Plumbing",
      planTier: "trial",
      status: "trial" as const,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    repository.seed(seeded);
    const useCase = new GetTenantUseCase({} as PrismaService, repository);

    const tenant = await useCase.execute("tenant-1");
    expect(tenant).toEqual(seeded);
  });

  it("throws TenantNotFoundError (mapped to HTTP 404) when the tenant doesn't exist", async () => {
    const repository = new FakeTenantRepository();
    const useCase = new GetTenantUseCase({} as PrismaService, repository);

    await expect(useCase.execute("does-not-exist")).rejects.toThrow(TenantNotFoundError);
  });
});
