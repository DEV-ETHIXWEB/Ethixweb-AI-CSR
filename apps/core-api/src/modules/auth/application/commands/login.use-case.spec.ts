import type { TenantContextService } from "../../../../shared/prisma/tenant-context.service";
import { InvalidCredentialsError, RateLimitExceededError } from "../../domain/errors";
import { PasswordHash } from "../../domain/value-objects/password-hash.vo";
import { createNoopLogger } from "../__fakes__/fake-logger";
import { FakeRateLimiter } from "../__fakes__/fake-rate-limiter";
import { FakeRefreshTokenStore } from "../__fakes__/fake-refresh-token-store";
import { FakeTenantContextService } from "../__fakes__/fake-tenant-context";
import { FakeTokenService } from "../__fakes__/fake-token-service";
import { FakeUserRepository } from "../__fakes__/fake-user-repository";
import { LOGIN_MAX_ATTEMPTS, LoginUseCase } from "./login.use-case";

async function seedUser(userRepository: FakeUserRepository) {
  const passwordHash = await PasswordHash.hash("a-genuinely-long-password");
  const user = {
    id: "user-1",
    tenantId: "tenant-1",
    email: "owner@allphaseplumbing.com",
    passwordHash: passwordHash.toStoredValue(),
    role: "owner" as const,
    lastLoginAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  userRepository.seed(user);
  return user;
}

function buildUseCase(
  userRepository = new FakeUserRepository(),
  tokenService = new FakeTokenService(),
  refreshTokenStore = new FakeRefreshTokenStore(),
  rateLimiter = new FakeRateLimiter(),
) {
  return new LoginUseCase(
    new FakeTenantContextService() as unknown as TenantContextService,
    userRepository,
    tokenService,
    refreshTokenStore,
    rateLimiter,
    createNoopLogger(),
  );
}

describe("LoginUseCase", () => {
  it("issues an access + refresh token pair for correct credentials", async () => {
    const userRepository = new FakeUserRepository();
    await seedUser(userRepository);
    const useCase = buildUseCase(userRepository);

    const result = await useCase.execute({
      tenantId: "tenant-1",
      email: "owner@allphaseplumbing.com",
      password: "a-genuinely-long-password",
    });

    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();
    expect(result.user.email).toBe("owner@allphaseplumbing.com");
  });

  it("stores the issued refresh token's jti so it validates as active", async () => {
    const userRepository = new FakeUserRepository();
    await seedUser(userRepository);
    const refreshTokenStore = new FakeRefreshTokenStore();
    const tokenService = new FakeTokenService();
    const useCase = buildUseCase(userRepository, tokenService, refreshTokenStore);

    const result = await useCase.execute({
      tenantId: "tenant-1",
      email: "owner@allphaseplumbing.com",
      password: "a-genuinely-long-password",
    });

    const payload = tokenService.verifyRefreshToken(result.refreshToken);
    expect(await refreshTokenStore.isValid(payload.sub, payload.jti)).toBe(true);
  });

  it("rejects a wrong password with the generic InvalidCredentialsError", async () => {
    const userRepository = new FakeUserRepository();
    await seedUser(userRepository);
    const useCase = buildUseCase(userRepository);

    await expect(
      useCase.execute({
        tenantId: "tenant-1",
        email: "owner@allphaseplumbing.com",
        password: "totally-wrong-password",
      }),
    ).rejects.toThrow(InvalidCredentialsError);
  });

  it("rejects a nonexistent email with the SAME generic error as a wrong password (no user enumeration)", async () => {
    const useCase = buildUseCase();

    await expect(
      useCase.execute({
        tenantId: "tenant-1",
        email: "nobody@example.com",
        password: "whatever-password-here",
      }),
    ).rejects.toThrow(InvalidCredentialsError);
  });

  it("rejects login against the wrong tenant even with otherwise-correct credentials", async () => {
    const userRepository = new FakeUserRepository();
    await seedUser(userRepository);
    const useCase = buildUseCase(userRepository);

    await expect(
      useCase.execute({
        tenantId: "a-different-tenant",
        email: "owner@allphaseplumbing.com",
        password: "a-genuinely-long-password",
      }),
    ).rejects.toThrow(InvalidCredentialsError);
  });

  it("rate-limits repeated attempts against the same (tenant, email), independent of credential correctness", async () => {
    const userRepository = new FakeUserRepository();
    await seedUser(userRepository);
    const rateLimiter = new FakeRateLimiter();
    const useCase = buildUseCase(userRepository, undefined, undefined, rateLimiter);
    const attempt = () =>
      useCase.execute({
        tenantId: "tenant-1",
        email: "owner@allphaseplumbing.com",
        password: "wrong-password-every-time",
      });

    for (let i = 0; i < LOGIN_MAX_ATTEMPTS; i++) {
      await expect(attempt()).rejects.toThrow(InvalidCredentialsError);
    }
    // One more, past the threshold — rejected before even reaching the
    // credential check.
    await expect(attempt()).rejects.toThrow(RateLimitExceededError);
  }, 30_000);

  it("rate limiting is scoped per (tenant, email) — a different account is unaffected", async () => {
    const userRepository = new FakeUserRepository();
    const user = await seedUser(userRepository);
    await userRepository.create(undefined as never, {
      tenantId: "tenant-1",
      email: "second-user@allphaseplumbing.com",
      passwordHash: user.passwordHash,
      role: "viewer",
    });
    const rateLimiter = new FakeRateLimiter();
    const useCase = buildUseCase(userRepository, undefined, undefined, rateLimiter);

    for (let i = 0; i < LOGIN_MAX_ATTEMPTS + 1; i++) {
      await useCase
        .execute({ tenantId: "tenant-1", email: "owner@allphaseplumbing.com", password: "wrong" })
        .catch(() => undefined);
    }

    // The exhausted account's own next attempt is rate-limited...
    await expect(
      useCase.execute({
        tenantId: "tenant-1",
        email: "owner@allphaseplumbing.com",
        password: "a-genuinely-long-password",
      }),
    ).rejects.toThrow(RateLimitExceededError);

    // ...but a different account in the same tenant is not.
    await expect(
      useCase.execute({
        tenantId: "tenant-1",
        email: "second-user@allphaseplumbing.com",
        password: "a-genuinely-long-password",
      }),
    ).resolves.toMatchObject({ user: { email: "second-user@allphaseplumbing.com" } });
  }, 30_000);
});
