import type { TenantContextService } from "../../../../shared/prisma/tenant-context.service";
import { UserNotFoundError } from "../../domain/errors";
import { FakeTenantContextService } from "../__fakes__/fake-tenant-context";
import { FakeUserRepository } from "../__fakes__/fake-user-repository";
import { GetCurrentUserUseCase } from "./get-current-user.use-case";

describe("GetCurrentUserUseCase", () => {
  it("returns the real, current user record — not a stale/decoded snapshot", async () => {
    const userRepository = new FakeUserRepository();
    userRepository.seed({
      id: "user-1",
      tenantId: "tenant-1",
      email: "owner@allphaseplumbing.com",
      passwordHash: "irrelevant",
      role: "owner",
      lastLoginAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const useCase = new GetCurrentUserUseCase(
      new FakeTenantContextService() as unknown as TenantContextService,
      userRepository,
    );

    const user = await useCase.execute("tenant-1", "user-1");

    expect(user.email).toBe("owner@allphaseplumbing.com");
    expect((user as { passwordHash?: unknown }).passwordHash).toBeUndefined();
  });

  it("throws UserNotFoundError for a user that doesn't exist", async () => {
    const useCase = new GetCurrentUserUseCase(
      new FakeTenantContextService() as unknown as TenantContextService,
      new FakeUserRepository(),
    );

    await expect(useCase.execute("tenant-1", "missing-user")).rejects.toThrow(UserNotFoundError);
  });

  it("IDOR defense in depth: a real user id from a DIFFERENT tenant is never returned", async () => {
    const userRepository = new FakeUserRepository();
    userRepository.seed({
      id: "user-1",
      tenantId: "tenant-a",
      email: "owner@tenant-a.com",
      passwordHash: "irrelevant",
      role: "owner",
      lastLoginAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const useCase = new GetCurrentUserUseCase(
      new FakeTenantContextService() as unknown as TenantContextService,
      userRepository,
    );

    // "tenant-1" and "user-1" would never both come from one real,
    // JWT-verified principal — this simulates the RLS-bypass/programmer-
    // error case UserRepository.findById's own tenantId parameter exists
    // to defend against, mirroring the same check already proven for
    // ApiKeyRepository.findById.
    await expect(useCase.execute("tenant-b", "user-1")).rejects.toThrow(UserNotFoundError);
  });
});
