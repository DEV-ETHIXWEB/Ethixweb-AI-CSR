import type { PrismaService } from "../../../shared/prisma/prisma.service";
import { TenantNotFoundError } from "../domain/errors";
import { createNoopLogger } from "./__fakes__/fake-logger";
import { FakeTenantRepository } from "./__fakes__/fake-tenant-repository";
import { UpdateTenantUseCase } from "./update-tenant.use-case";

describe("UpdateTenantUseCase", () => {
  function seedTenant(repository: FakeTenantRepository) {
    repository.seed({
      id: "tenant-1",
      name: "All Phase Plumbing",
      planTier: "trial",
      status: "trial",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  it("renames an existing tenant", async () => {
    const repository = new FakeTenantRepository();
    seedTenant(repository);
    const useCase = new UpdateTenantUseCase({} as PrismaService, repository, createNoopLogger());

    const updated = await useCase.execute("tenant-1", { name: "All Phase Plumbing LLC" });

    expect(updated.name).toBe("All Phase Plumbing LLC");
  });

  it("does not change planTier or status — this use-case has no way to accept them", async () => {
    const repository = new FakeTenantRepository();
    seedTenant(repository);
    const useCase = new UpdateTenantUseCase({} as PrismaService, repository, createNoopLogger());

    const updated = await useCase.execute("tenant-1", { name: "Renamed" });

    expect(updated.planTier).toBe("trial");
    expect(updated.status).toBe("trial");
  });

  it("throws TenantNotFoundError for a tenant that doesn't exist", async () => {
    const repository = new FakeTenantRepository();
    const useCase = new UpdateTenantUseCase({} as PrismaService, repository, createNoopLogger());

    await expect(useCase.execute("missing", { name: "Anything" })).rejects.toThrow(
      TenantNotFoundError,
    );
  });
});
