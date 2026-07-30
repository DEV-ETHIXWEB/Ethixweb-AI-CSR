import type { TenantContextService } from "../../../../shared/prisma/tenant-context.service";
import { ApiKeySecret } from "../../domain/value-objects/api-key-secret.vo";
import { createNoopLogger } from "../__fakes__/fake-logger";
import { FakeApiKeyRepository } from "../__fakes__/fake-api-key-repository";
import { FakeTenantContextService } from "../__fakes__/fake-tenant-context";
import { CreateApiKeyUseCase } from "./create-api-key.use-case";

describe("CreateApiKeyUseCase", () => {
  it("creates a key, returning the plaintext exactly once, never storing it", async () => {
    const apiKeyRepository = new FakeApiKeyRepository();
    const useCase = new CreateApiKeyUseCase(
      new FakeTenantContextService() as unknown as TenantContextService,
      apiKeyRepository,
      createNoopLogger(),
    );

    const result = await useCase.execute({ tenantId: "tenant-1", scopes: "full", expiresAt: null });

    expect(result.plaintextKey).toMatch(/^ethx_/);
    const stored = await apiKeyRepository.findById(undefined as never, "tenant-1", result.id);
    expect(stored?.keyHash).not.toBe(result.plaintextKey);
  });

  it("stores a key that can subsequently authenticate via findActiveByKeyHashForAuth", async () => {
    const apiKeyRepository = new FakeApiKeyRepository();
    const useCase = new CreateApiKeyUseCase(
      new FakeTenantContextService() as unknown as TenantContextService,
      apiKeyRepository,
      createNoopLogger(),
    );

    const result = await useCase.execute({
      tenantId: "tenant-1",
      scopes: "read_only",
      expiresAt: null,
    });

    const lookup = await apiKeyRepository.findActiveByKeyHashForAuth(
      undefined as never,
      ApiKeySecret.hashOf(result.plaintextKey),
    );
    expect(lookup?.tenantId).toBe("tenant-1");
    expect(lookup?.scopes).toBe("read_only");
  });
});
