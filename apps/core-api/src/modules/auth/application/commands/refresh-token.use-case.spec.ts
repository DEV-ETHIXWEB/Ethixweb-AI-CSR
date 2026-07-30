import type { TenantContextService } from "../../../../shared/prisma/tenant-context.service";
import { InvalidRefreshTokenError, UserNotFoundError } from "../../domain/errors";
import { createNoopLogger } from "../__fakes__/fake-logger";
import { FakeRefreshTokenStore } from "../__fakes__/fake-refresh-token-store";
import { FakeTenantContextService } from "../__fakes__/fake-tenant-context";
import { FakeTokenService } from "../__fakes__/fake-token-service";
import { FakeUserRepository } from "../__fakes__/fake-user-repository";
import { RefreshTokenUseCase } from "./refresh-token.use-case";

function seedUser(userRepository: FakeUserRepository) {
  const user = {
    id: "user-1",
    tenantId: "tenant-1",
    email: "owner@allphaseplumbing.com",
    passwordHash: "irrelevant-for-this-suite",
    role: "owner" as const,
    lastLoginAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  userRepository.seed(user);
  return user;
}

async function issueValidRefreshToken(
  tokenService: FakeTokenService,
  refreshTokenStore: FakeRefreshTokenStore,
  userId: string,
  tenantId: string,
) {
  const refreshToken = tokenService.issueRefreshToken({ sub: userId, jti: "jti-1", tenantId });
  await refreshTokenStore.store(userId, "jti-1", tokenService.refreshTokenTtlSeconds);
  return refreshToken;
}

function buildUseCase(
  userRepository = new FakeUserRepository(),
  tokenService = new FakeTokenService(),
  refreshTokenStore = new FakeRefreshTokenStore(),
) {
  return new RefreshTokenUseCase(
    new FakeTenantContextService() as unknown as TenantContextService,
    userRepository,
    tokenService,
    refreshTokenStore,
    createNoopLogger(),
  );
}

describe("RefreshTokenUseCase", () => {
  it("rotates a valid refresh token: issues a new pair and invalidates the old jti", async () => {
    const userRepository = new FakeUserRepository();
    const user = seedUser(userRepository);
    const tokenService = new FakeTokenService();
    const refreshTokenStore = new FakeRefreshTokenStore();
    const oldRefreshToken = await issueValidRefreshToken(
      tokenService,
      refreshTokenStore,
      user.id,
      user.tenantId,
    );
    const useCase = buildUseCase(userRepository, tokenService, refreshTokenStore);

    const result = await useCase.execute(oldRefreshToken);

    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).not.toBe(oldRefreshToken);
    expect(await refreshTokenStore.isValid(user.id, "jti-1")).toBe(false);
  });

  it("rejects a refresh token whose jti is no longer in the store (already rotated or revoked)", async () => {
    const userRepository = new FakeUserRepository();
    const user = seedUser(userRepository);
    const tokenService = new FakeTokenService();
    const refreshTokenStore = new FakeRefreshTokenStore();
    // Issue the JWT but never call store() — simulates a rotated-away token.
    const refreshToken = tokenService.issueRefreshToken({
      sub: user.id,
      jti: "never-stored",
      tenantId: user.tenantId,
    });
    const useCase = buildUseCase(userRepository, tokenService, refreshTokenStore);

    await expect(useCase.execute(refreshToken)).rejects.toThrow(InvalidRefreshTokenError);
  });

  it("rejects a malformed/unsigned refresh token outright", async () => {
    const useCase = buildUseCase();
    await expect(useCase.execute("not-a-real-token")).rejects.toThrow(InvalidRefreshTokenError);
  });

  it("rejects a REPLAY of the exact same refresh token after it's already been used once (rotation, not just theoretical)", async () => {
    const userRepository = new FakeUserRepository();
    const user = seedUser(userRepository);
    const tokenService = new FakeTokenService();
    const refreshTokenStore = new FakeRefreshTokenStore();
    const refreshToken = await issueValidRefreshToken(
      tokenService,
      refreshTokenStore,
      user.id,
      user.tenantId,
    );
    const useCase = buildUseCase(userRepository, tokenService, refreshTokenStore);

    // First use succeeds and rotates the token.
    await expect(useCase.execute(refreshToken)).resolves.toBeDefined();

    // An attacker (or a buggy client) replaying the exact same, now-stale
    // token must be rejected — this is the concrete behavior "replay
    // protection" means for refresh tokens, not just a theoretical property.
    await expect(useCase.execute(refreshToken)).rejects.toThrow(InvalidRefreshTokenError);
  });

  it("CONCURRENCY: two simultaneous uses of the same refresh token never both succeed", async () => {
    // Found during a security review: the old implementation checked
    // isValid() and called revoke() as two separate awaited steps, with
    // real async work (a tenant-scoped user lookup) in between — a window
    // where two concurrent callers presenting the same token could both
    // observe it as valid before either invalidated it, and both walk away
    // with a fresh, live token pair from a single original one. Firing both
    // calls via Promise.allSettled (not sequential awaits — the "replay"
    // test above already covers strict reuse-after-completion) exercises
    // exactly that interleaving. RefreshTokenStore.consume() closes it by
    // making the check-and-invalidate a single atomic step.
    const userRepository = new FakeUserRepository();
    const user = seedUser(userRepository);
    const tokenService = new FakeTokenService();
    const refreshTokenStore = new FakeRefreshTokenStore();
    const refreshToken = await issueValidRefreshToken(
      tokenService,
      refreshTokenStore,
      user.id,
      user.tenantId,
    );
    const useCase = buildUseCase(userRepository, tokenService, refreshTokenStore);

    const results = await Promise.allSettled([
      useCase.execute(refreshToken),
      useCase.execute(refreshToken),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(InvalidRefreshTokenError);
  });

  it("revokes the token and throws UserNotFoundError if the user has been deleted since the token was issued", async () => {
    const userRepository = new FakeUserRepository(); // no user seeded
    const tokenService = new FakeTokenService();
    const refreshTokenStore = new FakeRefreshTokenStore();
    const refreshToken = await issueValidRefreshToken(
      tokenService,
      refreshTokenStore,
      "deleted-user-id",
      "tenant-1",
    );
    const useCase = buildUseCase(userRepository, tokenService, refreshTokenStore);

    await expect(useCase.execute(refreshToken)).rejects.toThrow(UserNotFoundError);
    expect(await refreshTokenStore.isValid("deleted-user-id", "jti-1")).toBe(false);
  });
});
