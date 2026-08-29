import type { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import { IntegrationNotFoundError } from "../domain/errors";
import type { Integration } from "../domain/integration.entity";
import { createNoopLogger } from "./__fakes__/fake-logger";
import { FakeCredentialEncryptor } from "./__fakes__/fake-credential-encryptor";
import { FakeCrmAdapter } from "./__fakes__/fake-crm-adapter";
import { FakeCrmAdapterRegistry } from "./__fakes__/fake-crm-adapter-registry";
import { FakeCrmSyncLogRepository } from "./__fakes__/fake-crm-sync-log-repository";
import { FakeIntegrationRepository } from "./__fakes__/fake-integration-repository";
import { FakeTenantContextService } from "./__fakes__/fake-tenant-context";
import { SearchCustomerUseCase } from "./search-customer.use-case";

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

describe("SearchCustomerUseCase", () => {
  it("returns the matching customer and records a success CrmSyncLog entry", async () => {
    const integrationRepository = new FakeIntegrationRepository(new FakeCredentialEncryptor());
    await integrationRepository.seed(makeIntegration(), { type: "api_key", apiKey: "k" });
    const adapter = new FakeCrmAdapter();
    adapter.seedCustomer({
      crmCustomerId: "hcp-1",
      name: "Jane Doe",
      phoneE164: "+15551234567",
      raw: {},
    });
    const crmSyncLogRepository = new FakeCrmSyncLogRepository();
    const useCase = new SearchCustomerUseCase(
      new FakeTenantContextService() as unknown as TenantContextService,
      integrationRepository,
      new FakeCrmAdapterRegistry({ fake: adapter }),
      crmSyncLogRepository,
      createNoopLogger(),
    );

    const result = await useCase.execute({
      tenantId: "tenant-1",
      integrationId: "integration-1",
      phoneE164: "+15551234567",
    });

    expect(result?.crmCustomerId).toBe("hcp-1");
    expect(crmSyncLogRepository.records).toHaveLength(1);
    expect(crmSyncLogRepository.records[0]?.status).toBe("success");
    expect(crmSyncLogRepository.records[0]?.operation).toBe("searchCustomerByPhone");
  });

  it("returns null (not an error) for a genuine no-match", async () => {
    const integrationRepository = new FakeIntegrationRepository(new FakeCredentialEncryptor());
    await integrationRepository.seed(makeIntegration(), { type: "api_key", apiKey: "k" });
    const useCase = new SearchCustomerUseCase(
      new FakeTenantContextService() as unknown as TenantContextService,
      integrationRepository,
      new FakeCrmAdapterRegistry({ fake: new FakeCrmAdapter() }),
      new FakeCrmSyncLogRepository(),
      createNoopLogger(),
    );

    const result = await useCase.execute({
      tenantId: "tenant-1",
      integrationId: "integration-1",
      phoneE164: "+15559999999",
    });

    expect(result).toBeNull();
  });

  it("throws IntegrationNotFoundError for an integration that doesn't exist", async () => {
    const useCase = new SearchCustomerUseCase(
      new FakeTenantContextService() as unknown as TenantContextService,
      new FakeIntegrationRepository(new FakeCredentialEncryptor()),
      new FakeCrmAdapterRegistry({}),
      new FakeCrmSyncLogRepository(),
      createNoopLogger(),
    );

    await expect(
      useCase.execute({
        tenantId: "tenant-1",
        integrationId: "missing",
        phoneE164: "+15551234567",
      }),
    ).rejects.toThrow(IntegrationNotFoundError);
  });

  it("records a failed CrmSyncLog entry and rethrows when the adapter throws", async () => {
    const integrationRepository = new FakeIntegrationRepository(new FakeCredentialEncryptor());
    await integrationRepository.seed(makeIntegration(), { type: "api_key", apiKey: "k" });
    const failingAdapter = {
      crmType: "fake",
      searchCustomerByPhone: () => {
        throw new Error("network blip");
      },
    };
    const crmSyncLogRepository = new FakeCrmSyncLogRepository();
    const useCase = new SearchCustomerUseCase(
      new FakeTenantContextService() as unknown as TenantContextService,
      integrationRepository,
      new FakeCrmAdapterRegistry({ fake: failingAdapter as unknown as FakeCrmAdapter }),
      crmSyncLogRepository,
      createNoopLogger(),
    );

    await expect(
      useCase.execute({
        tenantId: "tenant-1",
        integrationId: "integration-1",
        phoneE164: "+15551234567",
      }),
    ).rejects.toThrow("network blip");
    expect(crmSyncLogRepository.records[0]?.status).toBe("failed");
  });

  it(
    "CONNECTION-POOL SAFETY: the CRM search call happens between two SEPARATE " +
      "tenantContext.run transactions, never nested inside one held open for its duration — " +
      "see this use case's own comment on why a single wrapping transaction would leave a real " +
      "Postgres connection held open for as long as a degraded CRM's retry/backoff takes",
    async () => {
      const integrationRepository = new FakeIntegrationRepository(new FakeCredentialEncryptor());
      await integrationRepository.seed(makeIntegration(), { type: "api_key", apiKey: "k" });
      const adapter = new FakeCrmAdapter();
      adapter.seedCustomer({
        crmCustomerId: "hcp-1",
        name: "Jane Doe",
        phoneE164: "+15551234567",
        raw: {},
      });
      const tenantContext = new FakeTenantContextService() as unknown as TenantContextService;
      const useCase = new SearchCustomerUseCase(
        tenantContext,
        integrationRepository,
        new FakeCrmAdapterRegistry({ fake: adapter }),
        new FakeCrmSyncLogRepository(),
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
      const originalSearch = adapter.searchCustomerByPhone.bind(adapter);
      jest.spyOn(adapter, "searchCustomerByPhone").mockImplementation(async (...args) => {
        events.push("search:start");
        const result = await originalSearch(...args);
        events.push("search:end");
        return result;
      });

      await useCase.execute({
        tenantId: "tenant-1",
        integrationId: "integration-1",
        phoneE164: "+15551234567",
      });

      expect(events).toEqual([
        "run:start",
        "run:end", // integration lookup + credential decryption — its own, already-closed transaction
        "search:start",
        "search:end", // the CRM call — no transaction open around it at all
        "run:start",
        "run:end", // the CrmSyncLog write — a fresh, separate transaction
      ]);
    },
  );
});
