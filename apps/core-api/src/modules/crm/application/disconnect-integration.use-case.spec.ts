import type { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import { IntegrationNotFoundError } from "../domain/errors";
import type { Integration } from "../domain/integration.entity";
import { createNoopLogger } from "./__fakes__/fake-logger";
import { FakeCredentialEncryptor } from "./__fakes__/fake-credential-encryptor";
import { FakeIntegrationRepository } from "./__fakes__/fake-integration-repository";
import { FakeTenantContextService } from "./__fakes__/fake-tenant-context";
import { DisconnectIntegrationUseCase } from "./disconnect-integration.use-case";

function makeIntegration(): Integration {
  return {
    id: "integration-1",
    tenantId: "tenant-a",
    businessId: "business-1",
    crmType: "fake",
    authType: "api_key",
    config: {},
    status: "active",
    lastVerifiedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("DisconnectIntegrationUseCase", () => {
  it("flips status to disconnected without deleting the row", async () => {
    const repository = new FakeIntegrationRepository(new FakeCredentialEncryptor());
    await repository.seed(makeIntegration(), { type: "api_key", apiKey: "k" });
    const useCase = new DisconnectIntegrationUseCase(
      new FakeTenantContextService() as unknown as TenantContextService,
      repository,
      createNoopLogger(),
    );

    const updated = await useCase.execute("tenant-a", "integration-1");

    expect(updated.status).toBe("disconnected");
    const stillThere = await repository.findById(undefined as never, "tenant-a", "integration-1");
    expect(stillThere).not.toBeNull();
  });

  it("throws IntegrationNotFoundError for an integration that doesn't exist", async () => {
    const repository = new FakeIntegrationRepository(new FakeCredentialEncryptor());
    const useCase = new DisconnectIntegrationUseCase(
      new FakeTenantContextService() as unknown as TenantContextService,
      repository,
      createNoopLogger(),
    );

    await expect(useCase.execute("tenant-a", "missing")).rejects.toThrow(IntegrationNotFoundError);
  });
});
