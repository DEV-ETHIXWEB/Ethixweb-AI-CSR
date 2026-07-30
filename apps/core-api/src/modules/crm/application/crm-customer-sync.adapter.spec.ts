import type { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import { FakeIntegrationRepository } from "../application/__fakes__/fake-integration-repository";
import { FakeCredentialEncryptor } from "../application/__fakes__/fake-credential-encryptor";
import { FakeTenantContextService } from "../application/__fakes__/fake-tenant-context";
import type { Integration } from "../domain/integration.entity";
import type { CreateCustomerUseCase } from "./create-customer.use-case";
import { CrmCustomerSyncAdapter } from "./crm-customer-sync.adapter";
import type { SearchCustomerUseCase } from "./search-customer.use-case";

function makeIntegration(overrides: Partial<Integration>): Integration {
  return {
    id: "integration-x",
    tenantId: "tenant-1",
    businessId: "business-1",
    crmType: "fake",
    authType: "api_key",
    config: {},
    status: "pending_verification",
    lastVerifiedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("CrmCustomerSyncAdapter", () => {
  describe("resolveActiveIntegrationId", () => {
    it("returns the id of the ACTIVE integration for the business", async () => {
      const integrationRepository = new FakeIntegrationRepository(new FakeCredentialEncryptor());
      await integrationRepository.seed(makeIntegration({ id: "int-active", status: "active" }), {
        type: "api_key",
        apiKey: "k",
      });
      const adapter = new CrmCustomerSyncAdapter(
        new FakeTenantContextService() as unknown as TenantContextService,
        integrationRepository,
        {} as SearchCustomerUseCase,
        {} as CreateCustomerUseCase,
      );

      const integrationId = await adapter.resolveActiveIntegrationId("tenant-1", "business-1");
      expect(integrationId).toBe("int-active");
    });

    it("ignores a non-active integration (e.g. pending_verification) and returns null", async () => {
      const integrationRepository = new FakeIntegrationRepository(new FakeCredentialEncryptor());
      await integrationRepository.seed(
        makeIntegration({ id: "int-pending", status: "pending_verification" }),
        { type: "api_key", apiKey: "k" },
      );
      const adapter = new CrmCustomerSyncAdapter(
        new FakeTenantContextService() as unknown as TenantContextService,
        integrationRepository,
        {} as SearchCustomerUseCase,
        {} as CreateCustomerUseCase,
      );

      expect(await adapter.resolveActiveIntegrationId("tenant-1", "business-1")).toBeNull();
    });

    it("returns null when the business has no integrations at all", async () => {
      const adapter = new CrmCustomerSyncAdapter(
        new FakeTenantContextService() as unknown as TenantContextService,
        new FakeIntegrationRepository(new FakeCredentialEncryptor()),
        {} as SearchCustomerUseCase,
        {} as CreateCustomerUseCase,
      );

      expect(await adapter.resolveActiveIntegrationId("tenant-1", "business-1")).toBeNull();
    });
  });

  it("searchCustomer delegates to crm's own SearchCustomerUseCase", async () => {
    // Kept as a plain, un-cast `jest.Mock` reference and asserted on
    // directly — accessing it back off the typed `searchCustomerUseCase`
    // object instead would trip @typescript-eslint/unbound-method (the
    // rule judges by the class's static method signature, not the runtime
    // jest.fn() actually assigned to it).
    const executeMock = jest.fn().mockResolvedValue({
      crmCustomerId: "hcp-1",
      name: "Jane Doe",
      phoneE164: "+15551234567",
      raw: {},
    });
    const searchCustomerUseCase = { execute: executeMock } as unknown as SearchCustomerUseCase;
    const adapter = new CrmCustomerSyncAdapter(
      new FakeTenantContextService() as unknown as TenantContextService,
      new FakeIntegrationRepository(new FakeCredentialEncryptor()),
      searchCustomerUseCase,
      {} as CreateCustomerUseCase,
    );

    const result = await adapter.searchCustomer("tenant-1", "integration-1", "+15551234567");

    expect(result?.crmCustomerId).toBe("hcp-1");
    expect(executeMock).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      integrationId: "integration-1",
      phoneE164: "+15551234567",
    });
  });

  it("createCustomer delegates to crm's own CreateCustomerUseCase", async () => {
    const executeMock = jest.fn().mockResolvedValue({
      crmCustomerId: "hcp-2",
      name: "Jane Doe",
      phoneE164: "+15551234567",
      raw: {},
    });
    const createCustomerUseCase = { execute: executeMock } as unknown as CreateCustomerUseCase;
    const adapter = new CrmCustomerSyncAdapter(
      new FakeTenantContextService() as unknown as TenantContextService,
      new FakeIntegrationRepository(new FakeCredentialEncryptor()),
      {} as SearchCustomerUseCase,
      createCustomerUseCase,
    );

    const result = await adapter.createCustomer("tenant-1", "integration-1", {
      name: "Jane Doe",
      phoneE164: "+15551234567",
    });

    expect(result.crmCustomerId).toBe("hcp-2");
    expect(executeMock).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      integrationId: "integration-1",
      name: "Jane Doe",
      phoneE164: "+15551234567",
      email: undefined,
    });
  });
});
