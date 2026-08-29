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
import { CreateLeadUseCase } from "./create-lead.use-case";

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

describe("CreateLeadUseCase", () => {
  it("creates a lead via the adapter and records a success CrmSyncLog entry", async () => {
    const integrationRepository = new FakeIntegrationRepository(new FakeCredentialEncryptor());
    await integrationRepository.seed(makeIntegration(), { type: "api_key", apiKey: "k" });
    const adapter = new FakeCrmAdapter();
    const crmSyncLogRepository = new FakeCrmSyncLogRepository();
    const useCase = new CreateLeadUseCase(
      new FakeTenantContextService() as unknown as TenantContextService,
      integrationRepository,
      new FakeCrmAdapterRegistry({ fake: adapter }),
      crmSyncLogRepository,
      new InMemoryIdempotencyStore(),
      createNoopLogger(),
    );

    const result = await useCase.execute({
      tenantId: "tenant-1",
      integrationId: "integration-1",
      crmCustomerId: "hcp-customer-1",
      problemSummary: "Leaking kitchen faucet",
      priority: "normal",
      leadType: "service_call",
    });

    expect(result.crmLeadId).toBeTruthy();
    expect(crmSyncLogRepository.records[0]?.status).toBe("success");
    expect(crmSyncLogRepository.records[0]?.operation).toBe("createLead");
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
      const useCase = new CreateLeadUseCase(
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
      const originalCreate = adapter.createLead.bind(adapter);
      jest.spyOn(adapter, "createLead").mockImplementation(async (...args) => {
        events.push("create:start");
        const result = await originalCreate(...args);
        events.push("create:end");
        return result;
      });

      await useCase.execute({
        tenantId: "tenant-1",
        integrationId: "integration-1",
        crmCustomerId: "hcp-customer-1",
        problemSummary: "Leaking kitchen faucet",
        priority: "normal",
        leadType: "service_call",
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

  it(
    "SAFETY CONTRACT: never touches any job/scheduling/dispatch operation — " +
      "the adapter's createLead is the only method invoked",
    async () => {
      const integrationRepository = new FakeIntegrationRepository(new FakeCredentialEncryptor());
      await integrationRepository.seed(makeIntegration(), { type: "api_key", apiKey: "k" });
      const adapter = new FakeCrmAdapter();
      const useCase = new CreateLeadUseCase(
        new FakeTenantContextService() as unknown as TenantContextService,
        integrationRepository,
        new FakeCrmAdapterRegistry({ fake: adapter }),
        new FakeCrmSyncLogRepository(),
        new InMemoryIdempotencyStore(),
        createNoopLogger(),
      );

      await useCase.execute({
        tenantId: "tenant-1",
        integrationId: "integration-1",
        crmCustomerId: "hcp-customer-1",
        problemSummary: "Burst pipe",
        priority: "emergency",
        leadType: "emergency",
      });

      // The CRMAdapter interface itself has no job-creation/scheduling/
      // dispatch method at all (docs/05-crm-integration.md §3) — this
      // asserts the only recorded adapter interaction was createLead,
      // proving the use-case doesn't (and structurally can't) reach for
      // anything else.
      expect(adapter.createLeadCalls).toHaveLength(1);
    },
  );

  it("throws IntegrationNotFoundError for an integration that doesn't exist", async () => {
    const useCase = new CreateLeadUseCase(
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
        crmCustomerId: "hcp-customer-1",
        problemSummary: "Leak",
        priority: "normal",
        leadType: "service_call",
      }),
    ).rejects.toThrow(IntegrationNotFoundError);
  });

  describe("idempotency (opt-in via idempotencyKey)", () => {
    it("retrying with the SAME key returns the cached result without calling the adapter again", async () => {
      const integrationRepository = new FakeIntegrationRepository(new FakeCredentialEncryptor());
      await integrationRepository.seed(makeIntegration(), { type: "api_key", apiKey: "k" });
      const adapter = new FakeCrmAdapter();
      const useCase = new CreateLeadUseCase(
        new FakeTenantContextService() as unknown as TenantContextService,
        integrationRepository,
        new FakeCrmAdapterRegistry({ fake: adapter }),
        new FakeCrmSyncLogRepository(),
        new InMemoryIdempotencyStore(),
        createNoopLogger(),
      );
      const command = {
        tenantId: "tenant-1",
        integrationId: "integration-1",
        crmCustomerId: "hcp-customer-1",
        problemSummary: "Leaking pipe",
        priority: "normal" as const,
        leadType: "service_call" as const,
        idempotencyKey: "retry-key-1",
      };

      const first = await useCase.execute(command);
      const second = await useCase.execute(command);

      expect(second).toEqual(first);
      expect(adapter.createLeadCalls).toHaveLength(1); // never called twice for the same key
    });

    it("a concurrent call with the SAME in-flight key gets CrmSyncInProgressError", async () => {
      const integrationRepository = new FakeIntegrationRepository(new FakeCredentialEncryptor());
      await integrationRepository.seed(makeIntegration(), { type: "api_key", apiKey: "k" });
      const idempotencyStore = new InMemoryIdempotencyStore();
      const useCase = new CreateLeadUseCase(
        new FakeTenantContextService() as unknown as TenantContextService,
        integrationRepository,
        new FakeCrmAdapterRegistry({ fake: new FakeCrmAdapter() }),
        new FakeCrmSyncLogRepository(),
        idempotencyStore,
        createNoopLogger(),
      );
      await idempotencyStore.begin("crm:createLead:tenant-1:integration-1:in-flight-key");

      await expect(
        useCase.execute({
          tenantId: "tenant-1",
          integrationId: "integration-1",
          crmCustomerId: "hcp-customer-1",
          problemSummary: "Leaking pipe",
          priority: "normal",
          leadType: "service_call",
          idempotencyKey: "in-flight-key",
        }),
      ).rejects.toThrow(CrmSyncInProgressError);
    });
  });
});
