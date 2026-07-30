import type { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import { IntegrationNotFoundError } from "../domain/errors";
import type { Integration } from "../domain/integration.entity";
import { FakeCredentialEncryptor } from "./__fakes__/fake-credential-encryptor";
import { FakeIntegrationRepository } from "./__fakes__/fake-integration-repository";
import { FakeTenantContextService } from "./__fakes__/fake-tenant-context";
import { GetIntegrationUseCase } from "./get-integration.use-case";

function makeIntegration(overrides: Partial<Integration> = {}): Integration {
  return {
    id: "integration-1",
    tenantId: "tenant-a",
    businessId: "business-1",
    crmType: "fake",
    authType: "api_key",
    config: {},
    status: "active",
    lastVerifiedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("GetIntegrationUseCase", () => {
  it("returns the integration when it belongs to the caller's tenant", async () => {
    const repository = new FakeIntegrationRepository(new FakeCredentialEncryptor());
    await repository.seed(makeIntegration(), { type: "api_key", apiKey: "k" });
    const useCase = new GetIntegrationUseCase(
      new FakeTenantContextService() as unknown as TenantContextService,
      repository,
    );

    const integration = await useCase.execute("tenant-a", "integration-1");
    expect(integration.crmType).toBe("fake");
  });

  it("throws IntegrationNotFoundError for an integration that doesn't exist", async () => {
    const repository = new FakeIntegrationRepository(new FakeCredentialEncryptor());
    const useCase = new GetIntegrationUseCase(
      new FakeTenantContextService() as unknown as TenantContextService,
      repository,
    );

    await expect(useCase.execute("tenant-a", "missing")).rejects.toThrow(IntegrationNotFoundError);
  });

  it("IDOR defense in depth: a real integration id from a DIFFERENT tenant is never returned", async () => {
    const repository = new FakeIntegrationRepository(new FakeCredentialEncryptor());
    await repository.seed(makeIntegration({ tenantId: "tenant-a" }), {
      type: "api_key",
      apiKey: "k",
    });
    const useCase = new GetIntegrationUseCase(
      new FakeTenantContextService() as unknown as TenantContextService,
      repository,
    );

    await expect(useCase.execute("tenant-b", "integration-1")).rejects.toThrow(
      IntegrationNotFoundError,
    );
  });
});
