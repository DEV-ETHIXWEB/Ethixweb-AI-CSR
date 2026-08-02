import type { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import { CallNotFoundForLeadError, CustomerNotFoundForLeadError } from "../domain/errors";
import { createNoopLogger } from "./__fakes__/fake-logger";
import { FakeCrmLeadSyncPort } from "./__fakes__/fake-crm-lead-sync-port";
import { FakeCustomerLookupPort } from "./__fakes__/fake-customer-lookup-port";
import { FakeLeadRepository } from "./__fakes__/fake-lead-repository";
import { FakeOutboxWriterFactory } from "./__fakes__/fake-outbox-writer-factory";
import { FakeTenantContextService } from "./__fakes__/fake-tenant-context";
import { CreateLeadUseCase, type CreateLeadCommand } from "./create-lead.use-case";

function buildUseCase(
  leadRepository = new FakeLeadRepository(),
  customerLookupPort = new FakeCustomerLookupPort(),
  crmLeadSyncPort = new FakeCrmLeadSyncPort(),
  outboxWriterFactory = new FakeOutboxWriterFactory(),
) {
  return new CreateLeadUseCase(
    new FakeTenantContextService() as unknown as TenantContextService,
    leadRepository,
    customerLookupPort,
    crmLeadSyncPort,
    outboxWriterFactory,
    createNoopLogger(),
  );
}

function seedCustomer(customerLookupPort: FakeCustomerLookupPort) {
  customerLookupPort.seed({
    id: "customer-1",
    tenantId: "tenant-1",
    businessId: "business-1",
    crmCustomerId: "crm-customer-1",
  });
}

function baseCommand(overrides: Partial<CreateLeadCommand> = {}): CreateLeadCommand {
  return {
    tenantId: "tenant-1",
    businessId: "business-1",
    customerId: "customer-1",
    callId: "call-1",
    problemSummary: "Water heater leaking",
    priority: "urgent",
    leadType: "residential",
    ...overrides,
  };
}

describe("CreateLeadUseCase", () => {
  it("creates a lead locally and syncs it to the CRM when a customer + active integration exist", async () => {
    const leadRepository = new FakeLeadRepository();
    const customerLookupPort = new FakeCustomerLookupPort();
    seedCustomer(customerLookupPort);
    const crmLeadSyncPort = new FakeCrmLeadSyncPort();
    const outboxWriterFactory = new FakeOutboxWriterFactory();
    const useCase = buildUseCase(
      leadRepository,
      customerLookupPort,
      crmLeadSyncPort,
      outboxWriterFactory,
    );

    const lead = await useCase.execute(baseCommand());

    expect(lead.status).toBe("new");
    expect(lead.crmLeadId).not.toBeNull();
    expect(crmLeadSyncPort.createLeadCalls).toHaveLength(1);
    expect(outboxWriterFactory.writtenEvents).toHaveLength(1);
    expect(outboxWriterFactory.writtenEvents[0]?.eventType).toBe("lead.created");
  });

  it("throws CustomerNotFoundForLeadError when the customerId doesn't resolve for this tenant", async () => {
    const useCase = buildUseCase();

    await expect(useCase.execute(baseCommand())).rejects.toThrow(CustomerNotFoundForLeadError);
  });

  it("throws CustomerNotFoundForLeadError when the customer belongs to a different business", async () => {
    const customerLookupPort = new FakeCustomerLookupPort();
    customerLookupPort.seed({
      id: "customer-1",
      tenantId: "tenant-1",
      businessId: "some-other-business",
      crmCustomerId: "crm-customer-1",
    });
    const useCase = buildUseCase(new FakeLeadRepository(), customerLookupPort);

    await expect(useCase.execute(baseCommand())).rejects.toThrow(CustomerNotFoundForLeadError);
  });

  it(
    "propagates CallNotFoundForLeadError unchanged (not swallowed/misclassified as the call_id " +
      "race) when the repository reports the callId has no matching Call row — proves the " +
      "production-blocker fix's error contract; the FK violation itself can only be proven " +
      "against real Postgres (see test/integration/lead-call-fk-integrity.integration-spec.ts)",
    async () => {
      const leadRepository = new FakeLeadRepository();
      leadRepository.create = jest
        .fn()
        .mockRejectedValue(new CallNotFoundForLeadError("orphan-call-id"));
      const customerLookupPort = new FakeCustomerLookupPort();
      seedCustomer(customerLookupPort);
      const useCase = buildUseCase(leadRepository, customerLookupPort);

      await expect(useCase.execute(baseCommand())).rejects.toThrow(CallNotFoundForLeadError);
    },
  );

  it("never blocks lead creation when the CRM sync fails — records a local-only lead with crmLeadId null", async () => {
    const customerLookupPort = new FakeCustomerLookupPort();
    seedCustomer(customerLookupPort);
    const crmLeadSyncPort = new FakeCrmLeadSyncPort();
    crmLeadSyncPort.failureError = new Error("CRM is down");
    const useCase = buildUseCase(new FakeLeadRepository(), customerLookupPort, crmLeadSyncPort);

    const lead = await useCase.execute(baseCommand());

    expect(lead.status).toBe("new");
    expect(lead.crmLeadId).toBeNull();
  });

  it("records a local-only lead when the business has no active CRM integration", async () => {
    const customerLookupPort = new FakeCustomerLookupPort();
    seedCustomer(customerLookupPort);
    const crmLeadSyncPort = new FakeCrmLeadSyncPort();
    crmLeadSyncPort.activeIntegrationId = null;
    const useCase = buildUseCase(new FakeLeadRepository(), customerLookupPort, crmLeadSyncPort);

    const lead = await useCase.execute(baseCommand());

    expect(lead.crmLeadId).toBeNull();
  });

  it("records a local-only lead when the customer has no crmCustomerId to link to yet", async () => {
    const customerLookupPort = new FakeCustomerLookupPort();
    customerLookupPort.seed({
      id: "customer-1",
      tenantId: "tenant-1",
      businessId: "business-1",
      crmCustomerId: null,
    });
    const crmLeadSyncPort = new FakeCrmLeadSyncPort();
    const useCase = buildUseCase(new FakeLeadRepository(), customerLookupPort, crmLeadSyncPort);

    const lead = await useCase.execute(baseCommand());

    expect(lead.crmLeadId).toBeNull();
    expect(crmLeadSyncPort.createLeadCalls).toHaveLength(0);
  });

  it(
    "CONCURRENCY: two createLead calls for the SAME call_id never create two leads — the losing " +
      "call returns the winning row, and the outbox event fires exactly once",
    async () => {
      const leadRepository = new FakeLeadRepository();
      const customerLookupPort = new FakeCustomerLookupPort();
      seedCustomer(customerLookupPort);
      const outboxWriterFactory = new FakeOutboxWriterFactory();
      const useCase = buildUseCase(
        leadRepository,
        customerLookupPort,
        new FakeCrmLeadSyncPort(),
        outboxWriterFactory,
      );
      const command = baseCommand();

      const [first, second] = await Promise.all([
        useCase.execute(command),
        useCase.execute(command),
      ]);

      expect(first.id).toBe(second.id);
      expect(outboxWriterFactory.writtenEvents).toHaveLength(1);
      const { total } = await leadRepository.listByBusiness(
        undefined as never,
        "tenant-1",
        "business-1",
        {
          page: 1,
          pageSize: 10,
        },
      );
      expect(total).toBe(1);
    },
  );

  it("salvages a losing attempt's own successful CRM sync onto the winning row rather than discarding it", async () => {
    const leadRepository = new FakeLeadRepository();
    const customerLookupPort = new FakeCustomerLookupPort();
    seedCustomer(customerLookupPort);
    // Pre-seed the "winning" row as if another concurrent call already
    // created it locally but its own CRM sync attempt failed.
    await leadRepository.create(undefined as never, {
      tenantId: "tenant-1",
      businessId: "business-1",
      customerId: "customer-1",
      callId: "call-1",
      crmLeadId: null,
      problemSummary: "Water heater leaking",
      priority: "urgent",
      leadType: "residential",
    });
    const crmLeadSyncPort = new FakeCrmLeadSyncPort();
    const useCase = buildUseCase(leadRepository, customerLookupPort, crmLeadSyncPort);

    const lead = await useCase.execute(baseCommand());

    expect(lead.crmLeadId).not.toBeNull();
  });
});
