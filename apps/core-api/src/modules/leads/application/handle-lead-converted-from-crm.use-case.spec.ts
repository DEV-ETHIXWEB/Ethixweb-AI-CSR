import type { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import type { Lead } from "../domain/lead.entity";
import { createNoopLogger } from "./__fakes__/fake-logger";
import { FakeLeadRepository } from "./__fakes__/fake-lead-repository";
import { FakeTenantContextService } from "./__fakes__/fake-tenant-context";
import { HandleLeadConvertedFromCrmUseCase } from "./handle-lead-converted-from-crm.use-case";

function seedLead(leadRepository: FakeLeadRepository, overrides: Partial<Lead> = {}): Lead {
  const lead: Lead = {
    id: "lead-1",
    tenantId: "tenant-1",
    businessId: "business-1",
    customerId: "customer-1",
    callId: "call-1",
    crmLeadId: "crm-lead-1",
    problemSummary: "Water heater leaking",
    priority: "urgent",
    leadType: "residential",
    status: "claimed",
    qualificationData: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
  leadRepository.seed(lead);
  return lead;
}

function buildUseCase(leadRepository: FakeLeadRepository) {
  return new HandleLeadConvertedFromCrmUseCase(
    new FakeTenantContextService() as unknown as TenantContextService,
    leadRepository,
    createNoopLogger(),
  );
}

describe("HandleLeadConvertedFromCrmUseCase", () => {
  it("transitions the matching local lead to converted_to_job", async () => {
    const leadRepository = new FakeLeadRepository();
    seedLead(leadRepository);
    const useCase = buildUseCase(leadRepository);

    const updated = await useCase.execute({ tenantId: "tenant-1", crmLeadId: "crm-lead-1" });

    expect(updated?.status).toBe("converted_to_job");
  });

  it("returns null (not an error) when no local lead matches the crmLeadId", async () => {
    const useCase = buildUseCase(new FakeLeadRepository());

    const result = await useCase.execute({ tenantId: "tenant-1", crmLeadId: "unknown-crm-lead" });

    expect(result).toBeNull();
  });

  it("is idempotent — a redelivered webhook for an already-converted lead is a no-op success", async () => {
    const leadRepository = new FakeLeadRepository();
    seedLead(leadRepository, { status: "converted_to_job" });
    const useCase = buildUseCase(leadRepository);

    const updated = await useCase.execute({ tenantId: "tenant-1", crmLeadId: "crm-lead-1" });

    expect(updated?.status).toBe("converted_to_job");
  });
});
