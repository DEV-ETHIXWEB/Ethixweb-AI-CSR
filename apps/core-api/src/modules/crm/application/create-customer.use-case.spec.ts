import { InMemoryIdempotencyStore } from "@ethixweb/shared-kernel";
import type { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import { CrmSyncInProgressError, IntegrationNotFoundError } from "../domain/errors";
import type { Integration } from "../domain/integration.entity";
import { createNoopLogger } from "./__fakes__/fake-logger";
import { FakeCredentialEncryptor } from "./__fakes__/fake-credential-encryptor";
import { FakeCrmAdapter } from "./__fakes__/fake-crm-adapter";
import { FakeCrmAdapterRegistry } from "./__fakes__/fake-crm-adapter-registry";
import { FakeCrmSyncLogRepository } from "./__fakes__/fake-crm-sync-log-repository";
import { FakeIntegrationRepository } from "./__fakes__/fake-integration-repository";
import { FakeTenantContextService } from "./__fakes__/fake-tenant-context";
import { CreateCustomerUseCase } from "./create-customer.use-case";

function makeIntegration(): Integration {
  return {
    id: "integration-1",
    tenantId: "tenant-1",
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

function buildUseCase(
  integrationRepository = new FakeIntegrationRepository(new FakeCredentialEncryptor()),
  adapter = new FakeCrmAdapter(),
  crmSyncLogRepository = new FakeCrmSyncLogRepository(),
) {
  return new CreateCustomerUseCase(
    new FakeTenantContextService() as unknown as TenantContextService,
    integrationRepository,
    new FakeCrmAdapterRegistry({ fake: adapter }),
    crmSyncLogRepository,
    new InMemoryIdempotencyStore(),
    createNoopLogger(),
  );
}

describe("CreateCustomerUseCase", () => {
  it("creates a customer via the adapter and records a success CrmSyncLog entry", async () => {
    const integrationRepository = new FakeIntegrationRepository(new FakeCredentialEncryptor());
    await integrationRepository.seed(makeIntegration(), { type: "api_key", apiKey: "k" });
    const crmSyncLogRepository = new FakeCrmSyncLogRepository();
    const useCase = buildUseCase(integrationRepository, new FakeCrmAdapter(), crmSyncLogRepository);

    const result = await useCase.execute({
      tenantId: "tenant-1",
      integrationId: "integration-1",
      name: "Jane Doe",
      phoneE164: "+15551234567",
      email: "jane@example.com",
    });

    expect(result.name).toBe("Jane Doe");
    expect(result.crmCustomerId).toBeTruthy();
    expect(crmSyncLogRepository.records[0]?.status).toBe("success");
    expect(crmSyncLogRepository.records[0]?.operation).toBe("createCustomer");
  });

  it("throws IntegrationNotFoundError for an integration that doesn't exist", async () => {
    const useCase = new CreateCustomerUseCase(
      new FakeTenantContextService() as unknown as TenantContextService,
      new FakeIntegrationRepository(new FakeCredentialEncryptor()),
      new FakeCrmAdapterRegistry({}),
      new FakeCrmSyncLogRepository(),
      new InMemoryIdempotencyStore(),
      createNoopLogger(),
    );

    await expect(
      useCase.execute({
        tenantId: "tenant-1",
        integrationId: "missing",
        name: "Jane Doe",
        phoneE164: "+15551234567",
      }),
    ).rejects.toThrow(IntegrationNotFoundError);
  });

  it(
    "CONNECTION-POOL SAFETY: the CRM create call happens between two SEPARATE " +
      "tenantContext.run transactions, never nested inside one held open for its duration — " +
      "see this use case's own comment on why a single wrapping transaction would leave a real " +
      "Postgres connection held open for as long as a degraded CRM's retry/backoff takes",
    async () => {
      const integrationRepository = new FakeIntegrationRepository(new FakeCredentialEncryptor());
      await integrationRepository.seed(makeIntegration(), { type: "api_key", apiKey: "k" });
      const adapter = new FakeCrmAdapter();
      const tenantContext = new FakeTenantContextService() as unknown as TenantContextService;
      const useCase = new CreateCustomerUseCase(
        tenantContext,
        integrationRepository,
        new FakeCrmAdapterRegistry({ fake: adapter }),
        new FakeCrmSyncLogRepository(),
        new InMemoryIdempotencyStore(),
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
      const originalCreate = adapter.createCustomer.bind(adapter);
      jest.spyOn(adapter, "createCustomer").mockImplementation(async (...args) => {
        events.push("create:start");
        const result = await originalCreate(...args);
        events.push("create:end");
        return result;
      });

      await useCase.execute({
        tenantId: "tenant-1",
        integrationId: "integration-1",
        name: "Jane Doe",
        phoneE164: "+15551234567",
      });

      expect(events).toEqual([
        "run:start",
        "run:end", // integration lookup + credential decryption — its own, already-closed transaction
        "create:start",
        "create:end", // the CRM call — no transaction open around it at all
        "run:start",
        "run:end", // the CrmSyncLog write — a fresh, separate transaction
      ]);
    },
  );

  describe("idempotency (opt-in via idempotencyKey)", () => {
    it("retrying with the SAME key returns the cached result without calling the adapter again", async () => {
      const integrationRepository = new FakeIntegrationRepository(new FakeCredentialEncryptor());
      await integrationRepository.seed(makeIntegration(), { type: "api_key", apiKey: "k" });
      const adapter = new FakeCrmAdapter();
      const createCustomerSpy = jest.spyOn(adapter, "createCustomer");
      const useCase = buildUseCase(integrationRepository, adapter);
      const command = {
        tenantId: "tenant-1",
        integrationId: "integration-1",
        name: "Jane Doe",
        phoneE164: "+15551234567",
        idempotencyKey: "retry-key-1",
      };

      const first = await useCase.execute(command);
      const second = await useCase.execute(command);

      expect(second).toEqual(first);
      expect(createCustomerSpy).toHaveBeenCalledTimes(1);
    });

    it("a concurrent call with the SAME in-flight key gets CrmSyncInProgressError", async () => {
      const integrationRepository = new FakeIntegrationRepository(new FakeCredentialEncryptor());
      await integrationRepository.seed(makeIntegration(), { type: "api_key", apiKey: "k" });
      const idempotencyStore = new InMemoryIdempotencyStore();
      const useCase = new CreateCustomerUseCase(
        new FakeTenantContextService() as unknown as TenantContextService,
        integrationRepository,
        new FakeCrmAdapterRegistry({ fake: new FakeCrmAdapter() }),
        new FakeCrmSyncLogRepository(),
        idempotencyStore,
        createNoopLogger(),
      );
      // Simulate a first request already in flight by reserving the key
      // directly, without ever completing it.
      await idempotencyStore.begin("crm:createCustomer:tenant-1:integration-1:in-flight-key");

      await expect(
        useCase.execute({
          tenantId: "tenant-1",
          integrationId: "integration-1",
          name: "Jane Doe",
          phoneE164: "+15551234567",
          idempotencyKey: "in-flight-key",
        }),
      ).rejects.toThrow(CrmSyncInProgressError);
    });

    it("without an idempotencyKey, two calls are never deduplicated (each creates independently)", async () => {
      const integrationRepository = new FakeIntegrationRepository(new FakeCredentialEncryptor());
      await integrationRepository.seed(makeIntegration(), { type: "api_key", apiKey: "k" });
      const adapter = new FakeCrmAdapter();
      const createCustomerSpy = jest.spyOn(adapter, "createCustomer");
      const useCase = buildUseCase(integrationRepository, adapter);
      const command = {
        tenantId: "tenant-1",
        integrationId: "integration-1",
        name: "Jane Doe",
        phoneE164: "+15551234567",
      };

      await useCase.execute(command);
      await useCase.execute(command);

      expect(createCustomerSpy).toHaveBeenCalledTimes(2);
    });

    it("releases the reservation on failure, so a retry after a failed attempt can proceed", async () => {
      const integrationRepository = new FakeIntegrationRepository(new FakeCredentialEncryptor());
      await integrationRepository.seed(makeIntegration(), { type: "api_key", apiKey: "k" });
      let shouldFail = true;
      const flakyAdapter = {
        crmType: "fake",
        createCustomer: async () => {
          if (shouldFail) {
            shouldFail = false;
            throw new Error("transient failure");
          }
          return {
            crmCustomerId: "recovered",
            name: "Jane Doe",
            phoneE164: "+15551234567",
            raw: {},
          };
        },
      };
      const useCase = new CreateCustomerUseCase(
        new FakeTenantContextService() as unknown as TenantContextService,
        integrationRepository,
        new FakeCrmAdapterRegistry({ fake: flakyAdapter as unknown as FakeCrmAdapter }),
        new FakeCrmSyncLogRepository(),
        new InMemoryIdempotencyStore(),
        createNoopLogger(),
      );
      const command = {
        tenantId: "tenant-1",
        integrationId: "integration-1",
        name: "Jane Doe",
        phoneE164: "+15551234567",
        idempotencyKey: "retry-after-failure",
      };

      await expect(useCase.execute(command)).rejects.toThrow("transient failure");
      const retried = await useCase.execute(command);
      expect(retried.crmCustomerId).toBe("recovered");
    });
  });
});
