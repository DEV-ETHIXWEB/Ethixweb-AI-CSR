import type { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import { LeadNotFoundError, LeadUpdateNotAuthorizedError } from "../domain/errors";
import type { Lead } from "../domain/lead.entity";
import { createNoopLogger } from "./__fakes__/fake-logger";
import { FakeLeadRepository } from "./__fakes__/fake-lead-repository";
import { FakeTenantContextService } from "./__fakes__/fake-tenant-context";
import { UpdateLeadUseCase } from "./update-lead.use-case";

function buildUseCase(leadRepository = new FakeLeadRepository()) {
  return new UpdateLeadUseCase(
    new FakeTenantContextService() as unknown as TenantContextService,
    leadRepository,
    createNoopLogger(),
  );
}

function seedLead(leadRepository: FakeLeadRepository, overrides: Partial<Lead> = {}): Lead {
  const lead: Lead = {
    id: "lead-1",
    tenantId: "tenant-1",
    businessId: "business-1",
    customerId: "customer-1",
    callId: "call-1",
    crmLeadId: null,
    problemSummary: "Water heater leaking",
    priority: "urgent",
    leadType: "residential",
    status: "new",
    qualificationData: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
  leadRepository.seed(lead);
  return lead;
}

describe("UpdateLeadUseCase", () => {
  it("applies a partial patch to the mutable fields when called from the creating call", async () => {
    const leadRepository = new FakeLeadRepository();
    seedLead(leadRepository);
    const useCase = buildUseCase(leadRepository);

    const updated = await useCase.execute({
      tenantId: "tenant-1",
      leadId: "lead-1",
      callId: "call-1",
      patch: { problemSummary: "Water heater leaking AND no hot water at all" },
    });

    expect(updated.problemSummary).toBe("Water heater leaking AND no hot water at all");
    expect(updated.priority).toBe("urgent"); // untouched field left alone
  });

  it("throws LeadNotFoundError for a lead that doesn't exist for this tenant", async () => {
    const useCase = buildUseCase();

    await expect(
      useCase.execute({ tenantId: "tenant-1", leadId: "missing", callId: "call-1", patch: {} }),
    ).rejects.toThrow(LeadNotFoundError);
  });

  it("throws LeadUpdateNotAuthorizedError when the callId doesn't match the lead's creating call", async () => {
    const leadRepository = new FakeLeadRepository();
    seedLead(leadRepository);
    const useCase = buildUseCase(leadRepository);

    await expect(
      useCase.execute({
        tenantId: "tenant-1",
        leadId: "lead-1",
        callId: "some-other-call",
        patch: { priority: "emergency" },
      }),
    ).rejects.toThrow(LeadUpdateNotAuthorizedError);
  });
});
