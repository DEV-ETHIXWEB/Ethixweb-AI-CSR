import type { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import type { Integration } from "../domain/integration.entity";
import { FakeCredentialEncryptor } from "./__fakes__/fake-credential-encryptor";
import { FakeIntegrationRepository } from "./__fakes__/fake-integration-repository";
import { FakeTenantContextService } from "./__fakes__/fake-tenant-context";
import { ListIntegrationsUseCase } from "./list-integrations.use-case";

function makeIntegration(overrides: Partial<Integration>): Integration {
  return {
    id: "integration-x",
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

describe("ListIntegrationsUseCase", () => {
  it("returns only integrations for the given tenant and business", async () => {
    const repository = new FakeIntegrationRepository(new FakeCredentialEncryptor());
    await repository.seed(
      makeIntegration({ id: "int-1", tenantId: "tenant-a", businessId: "biz-1" }),
      {
        type: "api_key",
        apiKey: "k",
      },
    );
    await repository.seed(
      makeIntegration({ id: "int-2", tenantId: "tenant-a", businessId: "biz-2" }),
      {
        type: "api_key",
        apiKey: "k",
      },
    );
    await repository.seed(
      makeIntegration({ id: "int-3", tenantId: "tenant-b", businessId: "biz-1" }),
      {
        type: "api_key",
        apiKey: "k",
      },
    );
    const useCase = new ListIntegrationsUseCase(
      new FakeTenantContextService() as unknown as TenantContextService,
      repository,
    );

    const integrations = await useCase.execute("tenant-a", "biz-1");

    expect(integrations).toHaveLength(1);
    expect(integrations[0]?.id).toBe("int-1");
  });

  it("returns an empty array when the business has no integrations", async () => {
    const repository = new FakeIntegrationRepository(new FakeCredentialEncryptor());
    const useCase = new ListIntegrationsUseCase(
      new FakeTenantContextService() as unknown as TenantContextService,
      repository,
    );

    expect(await useCase.execute("tenant-a", "biz-none")).toEqual([]);
  });
});
