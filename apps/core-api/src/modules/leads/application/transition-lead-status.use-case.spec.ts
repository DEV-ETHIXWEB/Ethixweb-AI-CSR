import type { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import { ConcurrentLeadModificationError, LeadNotFoundError } from "../domain/errors";
import { IllegalLeadStatusTransitionError } from "../domain/lead-lifecycle";
import type { Lead } from "../domain/lead.entity";
import { createNoopLogger } from "./__fakes__/fake-logger";
import { FakeLeadRepository } from "./__fakes__/fake-lead-repository";
import { FakeTenantContextService } from "./__fakes__/fake-tenant-context";
import { TransitionLeadStatusUseCase } from "./transition-lead-status.use-case";

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

function buildUseCase(leadRepository: FakeLeadRepository) {
  return new TransitionLeadStatusUseCase(
    new FakeTenantContextService() as unknown as TenantContextService,
    leadRepository,
    createNoopLogger(),
  );
}

describe("TransitionLeadStatusUseCase", () => {
  it("transitions a lead to a legal next status", async () => {
    const leadRepository = new FakeLeadRepository();
    seedLead(leadRepository, { status: "new" });
    const useCase = buildUseCase(leadRepository);

    const updated = await useCase.execute("tenant-1", "lead-1", "notified");

    expect(updated.status).toBe("notified");
  });

  it("throws LeadNotFoundError for a lead that doesn't exist for this tenant", async () => {
    const useCase = buildUseCase(new FakeLeadRepository());

    await expect(useCase.execute("tenant-1", "missing", "expired")).rejects.toThrow(
      LeadNotFoundError,
    );
  });

  it("rejects an illegal transition (new -> converted_to_job, skipping the required steps)", async () => {
    const leadRepository = new FakeLeadRepository();
    seedLead(leadRepository, { status: "new" });
    const useCase = buildUseCase(leadRepository);

    await expect(useCase.execute("tenant-1", "lead-1", "converted_to_job")).rejects.toThrow(
      IllegalLeadStatusTransitionError,
    );
  });

  it("treats a same-status transition as an idempotent no-op", async () => {
    const leadRepository = new FakeLeadRepository();
    seedLead(leadRepository, { status: "expired" });
    const useCase = buildUseCase(leadRepository);

    const updated = await useCase.execute("tenant-1", "lead-1", "expired");

    expect(updated.status).toBe("expired");
  });

  it(
    "CONCURRENCY: two transitions racing off the SAME starting status — exactly one applies, the " +
      "other gets ConcurrentLeadModificationError",
    async () => {
      const leadRepository = new FakeLeadRepository();
      seedLead(leadRepository, { status: "notified" });
      const useCase = buildUseCase(leadRepository);

      const [a, b] = await Promise.allSettled([
        useCase.execute("tenant-1", "lead-1", "claimed"),
        useCase.execute("tenant-1", "lead-1", "expired"),
      ]);

      const outcomes = [a, b];
      const fulfilled = outcomes.filter((o) => o.status === "fulfilled");
      const rejected = outcomes.filter((o) => o.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
        ConcurrentLeadModificationError,
      );
    },
  );
});
