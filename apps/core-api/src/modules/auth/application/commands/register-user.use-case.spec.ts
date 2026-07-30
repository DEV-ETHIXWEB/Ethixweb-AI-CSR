import type { TenantContextService } from "../../../../shared/prisma/tenant-context.service";
import { EmailAlreadyRegisteredError } from "../../domain/errors";
import { CannotAssignRoleError } from "../../domain/role-assignment-policy";
import { createNoopLogger } from "../__fakes__/fake-logger";
import { FakeTenantContextService } from "../__fakes__/fake-tenant-context";
import { FakeUserRepository } from "../__fakes__/fake-user-repository";
import { RegisterUserUseCase } from "./register-user.use-case";

function buildUseCase(userRepository = new FakeUserRepository()) {
  return new RegisterUserUseCase(
    new FakeTenantContextService() as unknown as TenantContextService,
    userRepository,
    createNoopLogger(),
  );
}

describe("RegisterUserUseCase", () => {
  it("registers a new user with a hashed password, normalized email, and never returns the hash", async () => {
    const useCase = buildUseCase();

    const user = await useCase.execute({
      tenantId: "tenant-1",
      email: "Owner@AllPhasePlumbing.com",
      password: "a-genuinely-long-password",
      role: "owner",
      actingUserRole: undefined, // bootstrap path — no acting user yet
    });

    expect(user.email).toBe("owner@allphaseplumbing.com");
    expect(user.role).toBe("owner");
    expect((user as { passwordHash?: unknown }).passwordHash).toBeUndefined();
  });

  it("rejects a second registration with the same email in the same tenant", async () => {
    const userRepository = new FakeUserRepository();
    const useCase = buildUseCase(userRepository);
    await useCase.execute({
      tenantId: "tenant-1",
      email: "owner@allphaseplumbing.com",
      password: "a-genuinely-long-password",
      role: "owner",
      actingUserRole: undefined,
    });

    await expect(
      useCase.execute({
        tenantId: "tenant-1",
        email: "owner@allphaseplumbing.com",
        password: "a-different-long-password",
        role: "admin",
        actingUserRole: "owner",
      }),
    ).rejects.toThrow(EmailAlreadyRegisteredError);
  });

  it("CONCURRENCY: two simultaneous registrations with the same email never both succeed", async () => {
    // The use-case's own findByEmail pre-check is a TOCTOU race under real
    // concurrency (two requests can both see "no existing user" before
    // either inserts) — found during a security review. The actual backstop
    // is the database's `@@unique([tenantId, email])` constraint
    // (packages/database/prisma/schema.prisma), translated to a clean
    // EmailAlreadyRegisteredError by PrismaUserRepository.create() instead
    // of surfacing as an unhandled 500. FakeUserRepository.create() mirrors
    // that same check-then-throw so this exact scenario is exercisable
    // without a real database.
    const userRepository = new FakeUserRepository();
    const useCase = buildUseCase(userRepository);
    const command = {
      tenantId: "tenant-1",
      email: "race@allphaseplumbing.com",
      password: "a-genuinely-long-password",
      role: "owner" as const,
      actingUserRole: undefined,
    };

    const results = await Promise.allSettled([useCase.execute(command), useCase.execute(command)]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      EmailAlreadyRegisteredError,
    );
  });

  it("allows the same email to be registered in a different tenant (uniqueness is per-tenant, not global)", async () => {
    const userRepository = new FakeUserRepository();
    const useCase = buildUseCase(userRepository);
    await useCase.execute({
      tenantId: "tenant-1",
      email: "owner@example.com",
      password: "a-genuinely-long-password",
      role: "owner",
      actingUserRole: undefined,
    });

    const secondTenantUser = await useCase.execute({
      tenantId: "tenant-2",
      email: "owner@example.com",
      password: "a-different-long-password",
      role: "owner",
      actingUserRole: undefined,
    });

    expect(secondTenantUser.tenantId).toBe("tenant-2");
  });

  describe("privilege escalation — role-assignment policy (docs: role-assignment-policy.ts)", () => {
    it("an owner CAN register a new owner", async () => {
      const useCase = buildUseCase();
      const user = await useCase.execute({
        tenantId: "tenant-1",
        email: "second-owner@example.com",
        password: "a-genuinely-long-password",
        role: "owner",
        actingUserRole: "owner",
      });
      expect(user.role).toBe("owner");
    });

    it("an admin CANNOT register a new owner (the vulnerability this policy closes)", async () => {
      const useCase = buildUseCase();
      await expect(
        useCase.execute({
          tenantId: "tenant-1",
          email: "escalated-owner@example.com",
          password: "a-genuinely-long-password",
          role: "owner",
          actingUserRole: "admin",
        }),
      ).rejects.toThrow(CannotAssignRoleError);
    });

    it("an admin CAN register a dispatcher or viewer", async () => {
      const useCase = buildUseCase();
      const dispatcher = await useCase.execute({
        tenantId: "tenant-1",
        email: "dispatcher@example.com",
        password: "a-genuinely-long-password",
        role: "dispatcher",
        actingUserRole: "admin",
      });
      expect(dispatcher.role).toBe("dispatcher");
    });

    it("a dispatcher cannot register anyone at all", async () => {
      const useCase = buildUseCase();
      await expect(
        useCase.execute({
          tenantId: "tenant-1",
          email: "nobody@example.com",
          password: "a-genuinely-long-password",
          role: "viewer",
          actingUserRole: "dispatcher",
        }),
      ).rejects.toThrow(CannotAssignRoleError);
    });

    it("the escalation attempt is rejected BEFORE any user row is created (no partial side effect)", async () => {
      const userRepository = new FakeUserRepository();
      const useCase = buildUseCase(userRepository);

      await expect(
        useCase.execute({
          tenantId: "tenant-1",
          email: "escalated-owner@example.com",
          password: "a-genuinely-long-password",
          role: "owner",
          actingUserRole: "admin",
        }),
      ).rejects.toThrow(CannotAssignRoleError);

      const created = await userRepository.findByEmail(
        undefined as never,
        "tenant-1",
        "escalated-owner@example.com",
      );
      expect(created).toBeNull();
    });
  });
});
