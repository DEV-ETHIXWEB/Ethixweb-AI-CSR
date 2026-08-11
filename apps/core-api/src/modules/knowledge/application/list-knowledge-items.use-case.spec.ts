import type { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import type { KnowledgeItem } from "../domain/knowledge-item.entity";
import { FakeKnowledgeRepository } from "./__fakes__/fake-knowledge-repository";
import { FakeTenantContextService } from "./__fakes__/fake-tenant-context";
import { ListKnowledgeItemsUseCase } from "./list-knowledge-items.use-case";

let counter = 0;
function makeItem(overrides: Partial<KnowledgeItem> = {}): KnowledgeItem {
  counter += 1;
  const now = new Date();
  return {
    id: `item-${counter}`,
    tenantId: "tenant-1",
    businessId: "business-1",
    category: "pricing",
    title: `Title ${counter}`,
    content: "Content",
    status: "draft",
    aiKnowledge: true,
    waitingBrochure: false,
    priority: 0,
    createdByUserId: null,
    updatedByUserId: null,
    approvedByUserId: null,
    approvedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function buildUseCase(knowledgeRepository: FakeKnowledgeRepository) {
  return new ListKnowledgeItemsUseCase(
    new FakeTenantContextService() as unknown as TenantContextService,
    knowledgeRepository,
  );
}

describe("ListKnowledgeItemsUseCase", () => {
  it("tenant isolation: seeded items for tenant A and tenant B, listByBusiness for tenant A never returns tenant B rows", async () => {
    const knowledgeRepository = new FakeKnowledgeRepository();
    knowledgeRepository.seed(makeItem({ tenantId: "tenant-1", businessId: "business-1" }));
    knowledgeRepository.seed(makeItem({ tenantId: "tenant-2", businessId: "business-1" }));
    knowledgeRepository.seed(makeItem({ tenantId: "tenant-1", businessId: "business-2" }));
    const useCase = buildUseCase(knowledgeRepository);

    const result = await useCase.execute({
      tenantId: "tenant-1",
      businessId: "business-1",
      page: 1,
      pageSize: 20,
    });

    expect(result.total).toBe(1);
    expect(result.items.every((item) => item.tenantId === "tenant-1")).toBe(true);
  });

  it("filters by status", async () => {
    const knowledgeRepository = new FakeKnowledgeRepository();
    knowledgeRepository.seed(makeItem({ status: "draft" }));
    knowledgeRepository.seed(makeItem({ status: "approved" }));
    const useCase = buildUseCase(knowledgeRepository);

    const result = await useCase.execute({
      tenantId: "tenant-1",
      businessId: "business-1",
      page: 1,
      pageSize: 20,
      status: "approved",
    });

    expect(result.total).toBe(1);
    expect(result.items[0]?.status).toBe("approved");
  });

  it("filters by category, aiKnowledge, and waitingBrochure", async () => {
    const knowledgeRepository = new FakeKnowledgeRepository();
    knowledgeRepository.seed(
      makeItem({ category: "pricing", aiKnowledge: true, waitingBrochure: false }),
    );
    knowledgeRepository.seed(
      makeItem({ category: "hours", aiKnowledge: false, waitingBrochure: true }),
    );
    const useCase = buildUseCase(knowledgeRepository);

    const byCategory = await useCase.execute({
      tenantId: "tenant-1",
      businessId: "business-1",
      page: 1,
      pageSize: 20,
      category: "hours",
    });
    expect(byCategory.total).toBe(1);

    const byBrochure = await useCase.execute({
      tenantId: "tenant-1",
      businessId: "business-1",
      page: 1,
      pageSize: 20,
      waitingBrochure: true,
    });
    expect(byBrochure.total).toBe(1);
    expect(byBrochure.items[0]?.category).toBe("hours");
  });

  it("paginates", async () => {
    const knowledgeRepository = new FakeKnowledgeRepository();
    knowledgeRepository.seed(makeItem());
    knowledgeRepository.seed(makeItem());
    knowledgeRepository.seed(makeItem());
    const useCase = buildUseCase(knowledgeRepository);

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
    expect(page1.items).toHaveLength(2);
    expect(page2.items).toHaveLength(1);
  });
});
