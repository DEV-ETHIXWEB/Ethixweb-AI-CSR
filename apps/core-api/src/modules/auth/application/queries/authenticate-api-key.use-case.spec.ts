import type { PrismaService } from "../../../../shared/prisma/prisma.service";
import { InvalidApiKeyError } from "../../domain/errors";
import { createNoopLogger } from "../__fakes__/fake-logger";
import { FakeApiKeyRepository } from "../__fakes__/fake-api-key-repository";
import { FakeTenantContextService } from "../__fakes__/fake-tenant-context";
import { CreateApiKeyUseCase } from "../commands/create-api-key.use-case";
import { AuthenticateApiKeyUseCase } from "./authenticate-api-key.use-case";
import type { TenantContextService } from "../../../../shared/prisma/tenant-context.service";

describe("AuthenticateApiKeyUseCase", () => {
  it("authenticates a valid, active key and resolves its tenant", async () => {
    const apiKeyRepository = new FakeApiKeyRepository();
    const createUseCase = new CreateApiKeyUseCase(
      new FakeTenantContextService() as unknown as TenantContextService,
      apiKeyRepository,
      createNoopLogger(),
    );
    const created = await createUseCase.execute({
      tenantId: "tenant-1",
      scopes: "full",
      expiresAt: null,
    });

    const authenticateUseCase = new AuthenticateApiKeyUseCase(
      {} as PrismaService,
      apiKeyRepository,
    );
    const principal = await authenticateUseCase.execute(created.plaintextKey);

    expect(principal.tenantId).toBe("tenant-1");
    expect(principal.scopes).toBe("full");
  });

  it("rejects an unrecognized key", async () => {
    const apiKeyRepository = new FakeApiKeyRepository();
    const authenticateUseCase = new AuthenticateApiKeyUseCase(
      {} as PrismaService,
      apiKeyRepository,
    );

    await expect(authenticateUseCase.execute("ethx_totally_made_up")).rejects.toThrow(
      InvalidApiKeyError,
    );
  });

  it("rejects a revoked key", async () => {
    const apiKeyRepository = new FakeApiKeyRepository();
    const tenantContext = new FakeTenantContextService() as unknown as TenantContextService;
    const createUseCase = new CreateApiKeyUseCase(
      tenantContext,
      apiKeyRepository,
      createNoopLogger(),
    );
    const created = await createUseCase.execute({
      tenantId: "tenant-1",
      scopes: "full",
      expiresAt: null,
    });
    await apiKeyRepository.revoke(undefined as never, "tenant-1", created.id, new Date());

    const authenticateUseCase = new AuthenticateApiKeyUseCase(
      {} as PrismaService,
      apiKeyRepository,
    );
    await expect(authenticateUseCase.execute(created.plaintextKey)).rejects.toThrow(
      InvalidApiKeyError,
    );
  });

  it("rejects an expired key", async () => {
    const apiKeyRepository = new FakeApiKeyRepository();
    const tenantContext = new FakeTenantContextService() as unknown as TenantContextService;
    const createUseCase = new CreateApiKeyUseCase(
      tenantContext,
      apiKeyRepository,
      createNoopLogger(),
    );
    const created = await createUseCase.execute({
      tenantId: "tenant-1",
      scopes: "full",
      expiresAt: new Date(Date.now() - 1000),
    });

    const authenticateUseCase = new AuthenticateApiKeyUseCase(
      {} as PrismaService,
      apiKeyRepository,
    );
    await expect(authenticateUseCase.execute(created.plaintextKey)).rejects.toThrow(
      InvalidApiKeyError,
    );
  });
});
