import type { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import { CrmAuthenticationError, IntegrationNotFoundError } from "../domain/errors";
import type { Integration } from "../domain/integration.entity";
import { createNoopLogger } from "./__fakes__/fake-logger";
import { FakeCredentialEncryptor } from "./__fakes__/fake-credential-encryptor";
import { FakeCrmAdapter } from "./__fakes__/fake-crm-adapter";
import { FakeCrmAdapterRegistry } from "./__fakes__/fake-crm-adapter-registry";
import { FakeIntegrationRepository } from "./__fakes__/fake-integration-repository";
import { FakeTenantContextService } from "./__fakes__/fake-tenant-context";
import { VerifyIntegrationUseCase } from "./verify-integration.use-case";

function seedIntegration(repository: FakeIntegrationRepository): Integration {
  const integration: Integration = {
    id: "integration-1",
    tenantId: "tenant-1",
    businessId: "business-1",
    crmType: "fake",
    authType: "api_key",
    config: {},
    status: "pending_verification",
    lastVerifiedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  void repository.seed(integration, { type: "api_key", apiKey: "test-key" });
  return integration;
}

describe("VerifyIntegrationUseCase", () => {
  it("marks the integration active and sets lastVerifiedAt on a successful test connection", async () => {
    const encryptor = new FakeCredentialEncryptor();
    const integrationRepository = new FakeIntegrationRepository(encryptor);
    seedIntegration(integrationRepository);
    const adapter = new FakeCrmAdapter();
    const useCase = new VerifyIntegrationUseCase(
      new FakeTenantContextService() as unknown as TenantContextService,
      integrationRepository,
      new FakeCrmAdapterRegistry({ fake: adapter }),
      createNoopLogger(),
    );

    const result = await useCase.execute("tenant-1", "integration-1");

    expect(result.status).toBe("active");
    expect(result.lastVerifiedAt).not.toBeNull();
  });

  it("marks the integration invalid_credentials and rethrows on an auth failure", async () => {
    const encryptor = new FakeCredentialEncryptor();
    const integrationRepository = new FakeIntegrationRepository(encryptor);
    seedIntegration(integrationRepository);
    const adapter = new FakeCrmAdapter();
    adapter.testConnectionShouldFail = true;
    // Force a CrmAuthenticationError specifically, not just any Error —
    // that's the exact case VerifyIntegrationUseCase treats differently.
    const failingAdapter = {
      ...adapter,
      testConnection: () => {
        throw new CrmAuthenticationError("fake", "bad key");
      },
    };
    const useCase = new VerifyIntegrationUseCase(
      new FakeTenantContextService() as unknown as TenantContextService,
      integrationRepository,
      new FakeCrmAdapterRegistry({ fake: failingAdapter as unknown as FakeCrmAdapter }),
      createNoopLogger(),
    );

    await expect(useCase.execute("tenant-1", "integration-1")).rejects.toThrow(
      CrmAuthenticationError,
    );

    const stored = await integrationRepository.findById(
      undefined as never,
      "tenant-1",
      "integration-1",
    );
    expect(stored?.status).toBe("invalid_credentials");
  });

  it("throws IntegrationNotFoundError for an integration that doesn't exist", async () => {
    const encryptor = new FakeCredentialEncryptor();
    const integrationRepository = new FakeIntegrationRepository(encryptor);
    const useCase = new VerifyIntegrationUseCase(
      new FakeTenantContextService() as unknown as TenantContextService,
      integrationRepository,
      new FakeCrmAdapterRegistry({}),
      createNoopLogger(),
    );

    await expect(useCase.execute("tenant-1", "missing")).rejects.toThrow(IntegrationNotFoundError);
  });

  it(
    "CONNECTION-POOL SAFETY: testConnection happens between two SEPARATE tenantContext.run " +
      "transactions, never nested inside one held open for its duration — see this use case's " +
      "own comment on why a single wrapping transaction would leave a real Postgres connection " +
      "held open for as long as a degraded CRM's retry/backoff takes",
    async () => {
      const encryptor = new FakeCredentialEncryptor();
      const integrationRepository = new FakeIntegrationRepository(encryptor);
      seedIntegration(integrationRepository);
      const adapter = new FakeCrmAdapter();
      const tenantContext = new FakeTenantContextService() as unknown as TenantContextService;
      const useCase = new VerifyIntegrationUseCase(
        tenantContext,
        integrationRepository,
        new FakeCrmAdapterRegistry({ fake: adapter }),
        createNoopLogger(),
      );
      const events: string[] = [];
      jest.spyOn(tenantContext, "run").mockImplementation(async (_tenantId, work) => {
        events.push("run:start");
        const result = await (work as (db: never) => Promise<unknown>)({
          $executeRaw: async () => 0,
        } as never);
        events.push("run:end");
        return result;
      });
      const originalTest = adapter.testConnection.bind(adapter);
      jest.spyOn(adapter, "testConnection").mockImplementation(async (...args) => {
        events.push("verify:start");
        const result = await originalTest(...args);
        events.push("verify:end");
        return result;
      });

      await useCase.execute("tenant-1", "integration-1");

      expect(events).toEqual([
        "run:start",
        "run:end", // integration lookup + credential decryption — its own, already-closed transaction
        "verify:start",
        "verify:end", // the CRM call — no transaction open around it at all
        "run:start",
        "run:end", // the status update — a fresh, separate transaction
      ]);
    },
  );
});
