import type { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import { CallNotFoundForLeadError, CustomerNotFoundForLeadError } from "../domain/errors";
import { createNoopLogger } from "./__fakes__/fake-logger";
import { FakeCrmLeadSyncPort } from "./__fakes__/fake-crm-lead-sync-port";
import { FakeCustomerLookupPort } from "./__fakes__/fake-customer-lookup-port";
import { FakeGetCallUseCase } from "./__fakes__/fake-get-call-use-case";
import { FakeLeadRepository } from "./__fakes__/fake-lead-repository";
import { FakeOutboxWriterFactory } from "./__fakes__/fake-outbox-writer-factory";
import { FakeTenantContextService } from "./__fakes__/fake-tenant-context";
import { CreateLeadUseCase, type CreateLeadCommand } from "./create-lead.use-case";
import type { GetCallUseCase } from "../../calls/application/get-call.use-case";

function buildUseCase(
  leadRepository = new FakeLeadRepository(),
  customerLookupPort = new FakeCustomerLookupPort(),
  crmLeadSyncPort = new FakeCrmLeadSyncPort(),
  outboxWriterFactory = new FakeOutboxWriterFactory(),
  getCallUseCase = new FakeGetCallUseCase(),
) {
  return new CreateLeadUseCase(
    new FakeTenantContextService() as unknown as TenantContextService,
    leadRepository,
    customerLookupPort,
    crmLeadSyncPort,
    outboxWriterFactory,
    getCallUseCase as unknown as GetCallUseCase,
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

  it(
    "SECURITY REGRESSION: rejects a callId that belongs to a DIFFERENT tenant, even though the " +
      "customer/business in the command are the caller's own valid ones — found live under " +
      "adversarial testing: tenant A could otherwise create a Lead keyed by tenant B's real " +
      "callId (cross-tenant data corruption), and because leads.call_id is a correct GLOBAL " +
      "unique constraint (Call.id is already globally unique), that row then permanently blocked " +
      "tenant B from ever creating their OWN legitimate lead for that call — tenant B's insert hit " +
      "the same constraint, but the RLS-scoped recovery read found nothing (the row belongs to " +
      "tenant A), surfacing as an unhandled 500 rather than a clean rejection",
    async () => {
      const customerLookupPort = new FakeCustomerLookupPort();
      seedCustomer(customerLookupPort);
      const getCallUseCase = new FakeGetCallUseCase();
      getCallUseCase.seed({
        id: "call-1",
        tenantId: "some-other-tenant",
        businessId: "business-1",
        customerId: "customer-1",
        direction: "inbound",
        fromNumber: "+15551234567",
        toNumber: "+15559876543",
        telephonyCallSid: "CAfake-other-tenant",
        status: "in_progress",
        endReason: null,
        durationSeconds: null,
        startedAt: new Date().toISOString(),
        endedAt: null,
      });
      const useCase = buildUseCase(
        new FakeLeadRepository(),
        customerLookupPort,
        new FakeCrmLeadSyncPort(),
        new FakeOutboxWriterFactory(),
        getCallUseCase,
      );

      await expect(useCase.execute(baseCommand())).rejects.toThrow(CallNotFoundForLeadError);
    },
  );

  it(
    "SECURITY REGRESSION: rejects a callId that belongs to the caller's own tenant but a " +
      "DIFFERENT business — same vulnerability class as the cross-tenant case above, one level " +
      "narrower (a multi-business tenant referencing another of its own businesses' calls)",
    async () => {
      const customerLookupPort = new FakeCustomerLookupPort();
      seedCustomer(customerLookupPort);
      const getCallUseCase = new FakeGetCallUseCase();
      getCallUseCase.seed({
        id: "call-1",
        tenantId: "tenant-1",
        businessId: "some-other-business",
        customerId: "customer-1",
        direction: "inbound",
        fromNumber: "+15551234567",
        toNumber: "+15559876543",
        telephonyCallSid: "CAfake-other-business",
        status: "in_progress",
        endReason: null,
        durationSeconds: null,
        startedAt: new Date().toISOString(),
        endedAt: null,
      });
      const useCase = buildUseCase(
        new FakeLeadRepository(),
        customerLookupPort,
        new FakeCrmLeadSyncPort(),
        new FakeOutboxWriterFactory(),
        getCallUseCase,
      );

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

  it(
    "REGRESSION: issues SAVEPOINT before the insert attempt and ROLLBACK TO SAVEPOINT before " +
      "the recovery read on a call_id race — without this, the recovery read runs inside a " +
      "Postgres transaction Postgres itself already aborted after the constraint violation " +
      "(25P02: 'current transaction is aborted'), which a mocked repository can never simulate " +
      "but genuine concurrent load against real Postgres hit immediately (found and fixed as a " +
      "real production-blocking bug, not a theoretical one)",
    async () => {
      const executedRawStatements: string[] = [];
      const fakeDb = {
        $executeRaw: (strings: TemplateStringsArray) => {
          executedRawStatements.push(strings.join(""));
          return Promise.resolve(0);
        },
      };
      const tenantContext = {
        run: async <T>(_tenantId: string, work: (db: unknown) => Promise<T>): Promise<T> =>
          work(fakeDb),
      };
      const leadRepository = new FakeLeadRepository();
      const customerLookupPort = new FakeCustomerLookupPort();
      seedCustomer(customerLookupPort);
      const useCase = new CreateLeadUseCase(
        tenantContext as unknown as TenantContextService,
        leadRepository,
        customerLookupPort,
        new FakeCrmLeadSyncPort(),
        new FakeOutboxWriterFactory(),
        new FakeGetCallUseCase() as unknown as GetCallUseCase,
        createNoopLogger(),
      );
      const command = baseCommand();

      await Promise.all([useCase.execute(command), useCase.execute(command)]);

      expect(executedRawStatements).toContain("SAVEPOINT create_lead_attempt");
      expect(executedRawStatements).toContain("ROLLBACK TO SAVEPOINT create_lead_attempt");
      // The SAVEPOINT must precede its own ROLLBACK for the losing call.
      const savepointIndex = executedRawStatements.indexOf("SAVEPOINT create_lead_attempt");
      const rollbackIndex = executedRawStatements.indexOf(
        "ROLLBACK TO SAVEPOINT create_lead_attempt",
      );
      expect(savepointIndex).toBeLessThan(rollbackIndex);
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
