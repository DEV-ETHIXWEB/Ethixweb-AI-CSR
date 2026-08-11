import type { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import type { KnowledgeItem } from "../domain/knowledge-item.entity";
import { FakeKnowledgeRepository } from "./__fakes__/fake-knowledge-repository";
import { FakeTenantContextService } from "./__fakes__/fake-tenant-context";
import { ListWaitingBrochureItemsUseCase } from "./list-waiting-brochure-items.use-case";

function buildUseCase(knowledgeRepository = new FakeKnowledgeRepository()) {
  return {
    useCase: new ListWaitingBrochureItemsUseCase(
      new FakeTenantContextService() as unknown as TenantContextService,
      knowledgeRepository,
    ),
    knowledgeRepository,
  };
}

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
    content: `Content ${counter}`,
    status: "approved",
    aiKnowledge: false,
    waitingBrochure: true,
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

describe("ListWaitingBrochureItemsUseCase", () => {
  it("returns only approved, waitingBrochure items for the business, ordered by priority ascending", async () => {
    const { useCase, knowledgeRepository } = buildUseCase();
    knowledgeRepository.seed(makeItem({ priority: 2, title: "Second" }));
    knowledgeRepository.seed(makeItem({ priority: 0, title: "First" }));
    knowledgeRepository.seed(makeItem({ status: "draft" })); // excluded: not approved
    knowledgeRepository.seed(makeItem({ waitingBrochure: false })); // excluded: not brochure-flagged
    knowledgeRepository.seed(makeItem({ tenantId: "tenant-2" })); // excluded: other tenant

    const items = await useCase.execute("tenant-1", "business-1");

    expect(items.map((item) => item.title)).toEqual(["First", "Second"]);
  });
});
