import type { PrismaService } from "../../../shared/prisma/prisma.service";
import { ConcurrentTenantModificationError, TenantNotFoundError } from "../domain/errors";
import { IllegalTenantStatusTransitionError } from "../domain/tenant-lifecycle";
import { createNoopLogger } from "./__fakes__/fake-logger";
import { FakeTenantRepository } from "./__fakes__/fake-tenant-repository";
import { TransitionTenantStatusUseCase } from "./transition-tenant-status.use-case";

describe("TransitionTenantStatusUseCase", () => {
  function seedTrialTenant(repository: FakeTenantRepository) {
    repository.seed({
      id: "tenant-1",
      name: "All Phase Plumbing",
      planTier: "trial",
      status: "trial",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  it("transitions a trial tenant to active", async () => {
    const repository = new FakeTenantRepository();
    seedTrialTenant(repository);
    const useCase = new TransitionTenantStatusUseCase(
      {} as PrismaService,
      repository,
      createNoopLogger(),
    );

    const tenant = await useCase.execute("tenant-1", "active");
    expect(tenant.status).toBe("active");
  });

  it("rejects an illegal transition (trial -> suspended) and leaves the tenant unchanged", async () => {
    const repository = new FakeTenantRepository();
    seedTrialTenant(repository);
    const useCase = new TransitionTenantStatusUseCase(
      {} as PrismaService,
      repository,
      createNoopLogger(),
    );

    await expect(useCase.execute("tenant-1", "suspended")).rejects.toThrow(
      IllegalTenantStatusTransitionError,
    );

    const tenant = await repository.findById({} as never, "tenant-1");
    expect(tenant?.status).toBe("trial");
  });

  it("throws TenantNotFoundError for a tenant that doesn't exist", async () => {
    const repository = new FakeTenantRepository();
    const useCase = new TransitionTenantStatusUseCase(
      {} as PrismaService,
      repository,
      createNoopLogger(),
    );

    await expect(useCase.execute("missing", "active")).rejects.toThrow(TenantNotFoundError);
  });

  it("CONCURRENCY: two simultaneous transitions off the same status never both succeed", async () => {
    // Found during a security/correctness review: an unconditional
    // `UPDATE ... SET status = toStatus WHERE id = id` has a write-write
    // race — two concurrent requests transitioning the same tenant to two
    // DIFFERENT (each individually legal) target statuses could both read
    // "active", both pass graph validation, and both write, with whichever
    // commits last silently overwriting the other with no error. Firing
    // both via Promise.allSettled (not sequential awaits) exercises that
    // interleaving. The repository's conditional
    // `updateMany({ id, status: fromStatus })` closes it: only the first to
    // commit succeeds, the second gets ConcurrentTenantModificationError.
    const repository = new FakeTenantRepository();
    repository.seed({
      id: "tenant-1",
      name: "All Phase Plumbing",
      planTier: "trial",
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const useCase = new TransitionTenantStatusUseCase(
      {} as PrismaService,
      repository,
      createNoopLogger(),
    );

    const results = await Promise.allSettled([
      useCase.execute("tenant-1", "past_due"),
      useCase.execute("tenant-1", "suspended"),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      ConcurrentTenantModificationError,
    );

    // Final state is exactly whichever transition won — never a corrupted
    // or silently-overwritten value, and never both applied.
    const finalTenant = await repository.findById({} as never, "tenant-1");
    expect(["past_due", "suspended"]).toContain(finalTenant?.status);
  });
});
