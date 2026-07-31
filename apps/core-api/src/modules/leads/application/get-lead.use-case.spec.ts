import type { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import { LeadNotFoundError } from "../domain/errors";
import type { Lead } from "../domain/lead.entity";
import { FakeLeadRepository } from "./__fakes__/fake-lead-repository";
import { FakeTenantContextService } from "./__fakes__/fake-tenant-context";
import { GetLeadUseCase } from "./get-lead.use-case";

function seedLead(leadRepository: FakeLeadRepository): Lead {
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
  };
  leadRepository.seed(lead);
  return lead;
}

describe("GetLeadUseCase", () => {
  it("returns the lead for the caller's own tenant", async () => {
    const leadRepository = new FakeLeadRepository();
    seedLead(leadRepository);
    const useCase = new GetLeadUseCase(
      new FakeTenantContextService() as unknown as TenantContextService,
      leadRepository,
    );

    const lead = await useCase.execute("tenant-1", "lead-1");

    expect(lead.id).toBe("lead-1");
  });

  it("throws LeadNotFoundError for another tenant's lead (tenant isolation)", async () => {
    const leadRepository = new FakeLeadRepository();
    seedLead(leadRepository);
    const useCase = new GetLeadUseCase(
      new FakeTenantContextService() as unknown as TenantContextService,
      leadRepository,
    );

    await expect(useCase.execute("tenant-2", "lead-1")).rejects.toThrow(LeadNotFoundError);
  });

  it("throws LeadNotFoundError for a non-existent lead id", async () => {
    const useCase = new GetLeadUseCase(
      new FakeTenantContextService() as unknown as TenantContextService,
      new FakeLeadRepository(),
    );

    await expect(useCase.execute("tenant-1", "missing")).rejects.toThrow(LeadNotFoundError);
  });
});
