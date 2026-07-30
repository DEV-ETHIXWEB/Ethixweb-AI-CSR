import type { TenantContextService } from "../../../../shared/prisma/tenant-context.service";
import { ApiKeyNotFoundError } from "../../domain/errors";
import { createNoopLogger } from "../__fakes__/fake-logger";
import { FakeApiKeyRepository } from "../__fakes__/fake-api-key-repository";
import { FakeTenantContextService } from "../__fakes__/fake-tenant-context";
import { CreateApiKeyUseCase } from "./create-api-key.use-case";
import { RevokeApiKeyUseCase } from "./revoke-api-key.use-case";

function buildUseCases(apiKeyRepository = new FakeApiKeyRepository()) {
  const tenantContext = new FakeTenantContextService() as unknown as TenantContextService;
  return {
    createUseCase: new CreateApiKeyUseCase(tenantContext, apiKeyRepository, createNoopLogger()),
    revokeUseCase: new RevokeApiKeyUseCase(tenantContext, apiKeyRepository, createNoopLogger()),
  };
}

describe("RevokeApiKeyUseCase", () => {
  it("revokes an existing key belonging to the caller's tenant", async () => {
    const apiKeyRepository = new FakeApiKeyRepository();
    const { createUseCase, revokeUseCase } = buildUseCases(apiKeyRepository);
    const created = await createUseCase.execute({
      tenantId: "tenant-1",
      scopes: "full",
      expiresAt: null,
    });

    const revoked = await revokeUseCase.execute("tenant-1", created.id);

    expect(revoked.revokedAt).not.toBeNull();
  });

  it("throws ApiKeyNotFoundError for a key that doesn't exist", async () => {
    const { revokeUseCase } = buildUseCases();
    await expect(revokeUseCase.execute("tenant-1", "does-not-exist")).rejects.toThrow(
      ApiKeyNotFoundError,
    );
  });

  it("IDOR: tenant B cannot revoke tenant A's key by guessing/reusing its id", async () => {
    const apiKeyRepository = new FakeApiKeyRepository();
    const { createUseCase, revokeUseCase } = buildUseCases(apiKeyRepository);
    const tenantAKey = await createUseCase.execute({
      tenantId: "tenant-a",
      scopes: "full",
      expiresAt: null,
    });

    // tenant-b presents tenant-a's real key id — must be treated identically
    // to "id does not exist," never leaking that the key exists at all.
    await expect(revokeUseCase.execute("tenant-b", tenantAKey.id)).rejects.toThrow(
      ApiKeyNotFoundError,
    );

    // And tenant A's key must still be un-revoked afterward.
    const stillActive = await apiKeyRepository.findById(
      undefined as never,
      "tenant-a",
      tenantAKey.id,
    );
    expect(stillActive?.revokedAt).toBeNull();
  });
});
