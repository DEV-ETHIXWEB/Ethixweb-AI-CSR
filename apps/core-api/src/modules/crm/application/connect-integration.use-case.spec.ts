import type { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import { createNoopLogger } from "./__fakes__/fake-logger";
import { FakeCredentialEncryptor } from "./__fakes__/fake-credential-encryptor";
import { FakeIntegrationRepository } from "./__fakes__/fake-integration-repository";
import { FakeTenantContextService } from "./__fakes__/fake-tenant-context";
import { ConnectIntegrationUseCase } from "./connect-integration.use-case";

function buildUseCase(
  integrationRepository = new FakeIntegrationRepository(new FakeCredentialEncryptor()),
) {
  return new ConnectIntegrationUseCase(
    new FakeTenantContextService() as unknown as TenantContextService,
    integrationRepository,
    new FakeCredentialEncryptor(),
    createNoopLogger(),
  );
}

describe("ConnectIntegrationUseCase", () => {
  it("creates an Integration starting in pending_verification", async () => {
    const useCase = buildUseCase();

    const integration = await useCase.execute({
      tenantId: "tenant-1",
      businessId: "business-1",
      crmType: "housecall_pro",
      credential: { type: "api_key", apiKey: "secret-key" },
    });

    expect(integration.tenantId).toBe("tenant-1");
    expect(integration.businessId).toBe("business-1");
    expect(integration.crmType).toBe("housecall_pro");
    expect(integration.authType).toBe("api_key");
    expect(integration.status).toBe("pending_verification");
  });

  it("never returns the credential itself on the created entity", async () => {
    const useCase = buildUseCase();

    const integration = await useCase.execute({
      tenantId: "tenant-1",
      businessId: "business-1",
      crmType: "housecall_pro",
      credential: { type: "api_key", apiKey: "super-secret" },
    });

    expect(JSON.stringify(integration)).not.toContain("super-secret");
  });
});
