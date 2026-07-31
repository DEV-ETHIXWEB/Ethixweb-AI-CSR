import type { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import { LeadAlreadyClaimedError, LeadNotFoundError } from "../domain/errors";
import { IllegalLeadStatusTransitionError } from "../domain/lead-lifecycle";
import type { Lead } from "../domain/lead.entity";
import { createNoopLogger } from "./__fakes__/fake-logger";
import { FakeLeadClaimRepository } from "./__fakes__/fake-lead-claim-repository";
import { FakeLeadRepository } from "./__fakes__/fake-lead-repository";
import { FakeTenantContextService } from "./__fakes__/fake-tenant-context";
import { ClaimLeadUseCase } from "./claim-lead.use-case";

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
    status: "notified",
    qualificationData: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
  leadRepository.seed(lead);
  return lead;
}

function buildUseCase(
  leadRepository: FakeLeadRepository,
  leadClaimRepository = new FakeLeadClaimRepository(),
) {
  return new ClaimLeadUseCase(
    new FakeTenantContextService() as unknown as TenantContextService,
    leadRepository,
    leadClaimRepository,
    createNoopLogger(),
  );
}

describe("ClaimLeadUseCase", () => {
  it("claims a notified lead and transitions it to claimed", async () => {
    const leadRepository = new FakeLeadRepository();
    seedLead(leadRepository);
    const useCase = buildUseCase(leadRepository);

    const result = await useCase.execute({
      tenantId: "tenant-1",
      leadId: "lead-1",
      claimedByUserId: "user-1",
      claimMethod: "manual",
    });

    expect(result.lead.status).toBe("claimed");
    expect(result.claim.claimedByUserId).toBe("user-1");
  });

  it("throws LeadNotFoundError for a lead that doesn't exist for this tenant", async () => {
    const useCase = buildUseCase(new FakeLeadRepository());

    await expect(
      useCase.execute({
        tenantId: "tenant-1",
        leadId: "missing",
        claimedByUserId: "user-1",
        claimMethod: "manual",
      }),
    ).rejects.toThrow(LeadNotFoundError);
  });

  it("rejects claiming a lead still in 'new' status (must be notified first, per the documented state machine)", async () => {
    const leadRepository = new FakeLeadRepository();
    seedLead(leadRepository, { status: "new" });
    const useCase = buildUseCase(leadRepository);

    await expect(
      useCase.execute({
        tenantId: "tenant-1",
        leadId: "lead-1",
        claimedByUserId: "user-1",
        claimMethod: "manual",
      }),
    ).rejects.toThrow(IllegalLeadStatusTransitionError);
  });

  it("rejects claiming an already-terminal (expired) lead", async () => {
    const leadRepository = new FakeLeadRepository();
    seedLead(leadRepository, { status: "expired" });
    const useCase = buildUseCase(leadRepository);

    await expect(
      useCase.execute({
        tenantId: "tenant-1",
        leadId: "lead-1",
        claimedByUserId: "user-1",
        claimMethod: "manual",
      }),
    ).rejects.toThrow(IllegalLeadStatusTransitionError);
  });

  it(
    "CONCURRENCY: two dispatchers racing to claim the SAME lead — exactly one wins, the other gets " +
      "LeadAlreadyClaimedError, and the lead ends up claimed exactly once",
    async () => {
      const leadRepository = new FakeLeadRepository();
      seedLead(leadRepository);
      const leadClaimRepository = new FakeLeadClaimRepository();
      const useCase = buildUseCase(leadRepository, leadClaimRepository);

      const [a, b] = await Promise.allSettled([
        useCase.execute({
          tenantId: "tenant-1",
          leadId: "lead-1",
          claimedByUserId: "user-A",
          claimMethod: "manual",
        }),
        useCase.execute({
          tenantId: "tenant-1",
          leadId: "lead-1",
          claimedByUserId: "user-B",
          claimMethod: "manual",
        }),
      ]);

      const outcomes = [a, b];
      const fulfilled = outcomes.filter((o) => o.status === "fulfilled");
      const rejected = outcomes.filter((o) => o.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(LeadAlreadyClaimedError);

      const finalLead = await leadRepository.findById(undefined as never, "tenant-1", "lead-1");
      expect(finalLead?.status).toBe("claimed");
    },
  );
});
