import type { ExecutionContext } from "@nestjs/common";
import type { Reflector } from "@nestjs/core";
import type { PrismaService } from "../../../../shared/prisma/prisma.service";
import type { RequestWithPrincipal } from "../../../../shared/auth/request-principal";
import { InvalidAccessTokenError } from "../../domain/errors";
import { AuthenticateApiKeyUseCase } from "../../application/queries/authenticate-api-key.use-case";
import { CreateApiKeyUseCase } from "../../application/commands/create-api-key.use-case";
import { FakeApiKeyRepository } from "../../application/__fakes__/fake-api-key-repository";
import { createNoopLogger } from "../../application/__fakes__/fake-logger";
import { FakeTenantContextService } from "../../application/__fakes__/fake-tenant-context";
import { FakeTokenService } from "../../application/__fakes__/fake-token-service";
import type { TenantContextService } from "../../../../shared/prisma/tenant-context.service";
import { AuthGuard } from "./auth.guard";

function buildContext(request: Partial<RequestWithPrincipal>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => (): void => undefined,
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

function buildReflector(isPublic: boolean): Reflector {
  return { getAllAndOverride: () => isPublic } as unknown as Reflector;
}

describe("AuthGuard", () => {
  it("allows a @Public() route through without any credential", async () => {
    const tokenService = new FakeTokenService();
    const guard = new AuthGuard(
      buildReflector(true),
      tokenService,
      new AuthenticateApiKeyUseCase({} as PrismaService, new FakeApiKeyRepository()),
    );
    const context = buildContext({ headers: {} });

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it("attaches a JWT principal for a valid Bearer token", async () => {
    const tokenService = new FakeTokenService();
    const accessToken = tokenService.issueAccessToken({
      sub: "user-1",
      tenantId: "tenant-1",
      role: "owner",
    });
    const guard = new AuthGuard(
      buildReflector(false),
      tokenService,
      new AuthenticateApiKeyUseCase({} as PrismaService, new FakeApiKeyRepository()),
    );
    const request = { headers: { authorization: `Bearer ${accessToken}` } } as RequestWithPrincipal;
    const context = buildContext(request);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.principal).toEqual({
      authType: "jwt",
      tenantId: "tenant-1",
      userId: "user-1",
      role: "owner",
    });
  });

  it("attaches an api_key principal for a valid X-Api-Key header", async () => {
    const apiKeyRepository = new FakeApiKeyRepository();
    const createApiKey = new CreateApiKeyUseCase(
      new FakeTenantContextService() as unknown as TenantContextService,
      apiKeyRepository,
      createNoopLogger(),
    );
    const created = await createApiKey.execute({
      tenantId: "tenant-1",
      scopes: "full",
      expiresAt: null,
    });

    const guard = new AuthGuard(
      buildReflector(false),
      new FakeTokenService(),
      new AuthenticateApiKeyUseCase({} as PrismaService, apiKeyRepository),
    );
    const request = {
      headers: { "x-api-key": created.plaintextKey },
    } as unknown as RequestWithPrincipal;
    const context = buildContext(request);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.principal).toEqual({
      authType: "api_key",
      tenantId: "tenant-1",
      apiKeyId: created.id,
      scopes: "full",
    });
  });

  it("rejects a request with neither header on a non-public route", async () => {
    const guard = new AuthGuard(
      buildReflector(false),
      new FakeTokenService(),
      new AuthenticateApiKeyUseCase({} as PrismaService, new FakeApiKeyRepository()),
    );
    const context = buildContext({ headers: {} });

    await expect(guard.canActivate(context)).rejects.toThrow(InvalidAccessTokenError);
  });

  it("rejects a malformed Bearer token", async () => {
    const guard = new AuthGuard(
      buildReflector(false),
      new FakeTokenService(),
      new AuthenticateApiKeyUseCase({} as PrismaService, new FakeApiKeyRepository()),
    );
    const request = {
      headers: { authorization: "Bearer not-a-real-token" },
    } as RequestWithPrincipal;
    const context = buildContext(request);

    await expect(guard.canActivate(context)).rejects.toThrow(InvalidAccessTokenError);
  });
});
