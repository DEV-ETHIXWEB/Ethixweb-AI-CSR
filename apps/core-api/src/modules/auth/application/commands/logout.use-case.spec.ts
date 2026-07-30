import { createNoopLogger } from "../__fakes__/fake-logger";
import { FakeRefreshTokenStore } from "../__fakes__/fake-refresh-token-store";
import { FakeTokenService } from "../__fakes__/fake-token-service";
import { LogoutUseCase } from "./logout.use-case";

describe("LogoutUseCase", () => {
  it("revokes a valid refresh token's jti", async () => {
    const tokenService = new FakeTokenService();
    const refreshTokenStore = new FakeRefreshTokenStore();
    const refreshToken = tokenService.issueRefreshToken({
      sub: "user-1",
      jti: "jti-1",
      tenantId: "tenant-1",
    });
    await refreshTokenStore.store("user-1", "jti-1", 1000);
    const useCase = new LogoutUseCase(tokenService, refreshTokenStore, createNoopLogger());

    await useCase.execute(refreshToken);

    expect(await refreshTokenStore.isValid("user-1", "jti-1")).toBe(false);
  });

  it("is idempotent — does not throw on an already-invalid/malformed token", async () => {
    const tokenService = new FakeTokenService();
    const refreshTokenStore = new FakeRefreshTokenStore();
    const useCase = new LogoutUseCase(tokenService, refreshTokenStore, createNoopLogger());

    await expect(useCase.execute("not-a-real-token")).resolves.toBeUndefined();
  });
});
