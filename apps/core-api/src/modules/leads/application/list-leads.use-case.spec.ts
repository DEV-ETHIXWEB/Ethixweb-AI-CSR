import type { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import type { Lead } from "../domain/lead.entity";
import { FakeLeadRepository } from "./__fakes__/fake-lead-repository";
import { FakeTenantContextService } from "./__fakes__/fake-tenant-context";
import { ListLeadsUseCase } from "./list-leads.use-case";

let counter = 0;
function makeLead(overrides: Partial<Lead> = {}): Lead {
  counter += 1;
  const now = new Date();
  return {
    id: `lead-${counter}`,
    tenantId: "tenant-1",
    businessId: "business-1",
    customerId: "customer-1",
    callId: `call-${counter}`,
    crmLeadId: null,
    problemSummary: "Problem",
    priority: "routine",
    leadType: "residential",
    status: "new",
    qualificationData: {},
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function buildUseCase(leadRepository: FakeLeadRepository) {
  return new ListLeadsUseCase(
    new FakeTenantContextService() as unknown as TenantContextService,
    leadRepository,
  );
}

describe("ListLeadsUseCase", () => {
  it("only returns leads for the requested tenant + business", async () => {
    const leadRepository = new FakeLeadRepository();
    leadRepository.seed(makeLead());
    leadRepository.seed(makeLead({ tenantId: "tenant-2" }));
    leadRepository.seed(makeLead({ businessId: "business-2" }));
    const useCase = buildUseCase(leadRepository);

    const result = await useCase.execute({
      tenantId: "tenant-1",
      businessId: "business-1",
      page: 1,
      pageSize: 20,
    });

    expect(result.total).toBe(1);
  });

  it("filters by status", async () => {
    const leadRepository = new FakeLeadRepository();
    leadRepository.seed(makeLead({ status: "new" }));
    leadRepository.seed(makeLead({ status: "claimed" }));
    const useCase = buildUseCase(leadRepository);

    const result = await useCase.execute({
      tenantId: "tenant-1",
      businessId: "business-1",
      page: 1,
      pageSize: 20,
      status: "claimed",
    });

    expect(result.total).toBe(1);
    expect(result.items[0]?.status).toBe("claimed");
  });

  it("filters by priority", async () => {
    const leadRepository = new FakeLeadRepository();
    leadRepository.seed(makeLead({ priority: "emergency" }));
    leadRepository.seed(makeLead({ priority: "routine" }));
    const useCase = buildUseCase(leadRepository);

    const result = await useCase.execute({
      tenantId: "tenant-1",
      businessId: "business-1",
      page: 1,
      pageSize: 20,
      priority: "emergency",
    });

    expect(result.total).toBe(1);
    expect(result.items[0]?.priority).toBe("emergency");
  });

  it("filters by createdAfter/createdBefore", async () => {
    const leadRepository = new FakeLeadRepository();
    const old = makeLead({ createdAt: new Date("2020-01-01") });
    const recent = makeLead({ createdAt: new Date("2026-01-01") });
    leadRepository.seed(old);
    leadRepository.seed(recent);
    const useCase = buildUseCase(leadRepository);

    const result = await useCase.execute({
      tenantId: "tenant-1",
      businessId: "business-1",
      page: 1,
      pageSize: 20,
      createdAfter: new Date("2025-01-01"),
    });

    expect(result.total).toBe(1);
    expect(result.items[0]?.id).toBe(recent.id);
  });

  it("paginates and orders newest-first", async () => {
    const leadRepository = new FakeLeadRepository();
    const first = makeLead({ createdAt: new Date("2026-01-01") });
    const second = makeLead({ createdAt: new Date("2026-01-02") });
    const third = makeLead({ createdAt: new Date("2026-01-03") });
    leadRepository.seed(first);
    leadRepository.seed(second);
    leadRepository.seed(third);
    const useCase = buildUseCase(leadRepository);

    const page1 = await useCase.execute({
      tenantId: "tenant-1",
      businessId: "business-1",
      page: 1,
      pageSize: 2,
    });
    const page2 = await useCase.execute({
      tenantId: "tenant-1",
      businessId: "business-1",
      page: 2,
      pageSize: 2,
    });

    expect(page1.total).toBe(3);
    expect(page1.items.map((lead) => lead.id)).toEqual([third.id, second.id]);
    expect(page2.items.map((lead) => lead.id)).toEqual([first.id]);
  });
});
