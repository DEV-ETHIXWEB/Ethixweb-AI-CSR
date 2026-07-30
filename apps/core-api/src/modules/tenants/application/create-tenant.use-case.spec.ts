import type { PrismaService } from "../../../shared/prisma/prisma.service";
import { createNoopLogger } from "./__fakes__/fake-logger";
import { FakeTenantRepository } from "./__fakes__/fake-tenant-repository";
import { CreateTenantUseCase } from "./create-tenant.use-case";

describe("CreateTenantUseCase", () => {
  it("creates a tenant defaulting to the trial plan tier and status", async () => {
    const repository = new FakeTenantRepository();
    const useCase = new CreateTenantUseCase({} as PrismaService, repository, createNoopLogger());

    const tenant = await useCase.execute({ name: "All Phase Plumbing Inc" });

    expect(tenant.name).toBe("All Phase Plumbing Inc");
    expect(tenant.planTier).toBe("trial");
    expect(tenant.status).toBe("trial");
    expect(tenant.id).toBeTruthy();
  });

  it("honors an explicitly requested plan tier", async () => {
    const repository = new FakeTenantRepository();
    const useCase = new CreateTenantUseCase({} as PrismaService, repository, createNoopLogger());

    const tenant = await useCase.execute({ name: "Enterprise Co", planTier: "enterprise" });

    expect(tenant.planTier).toBe("enterprise");
  });
});
