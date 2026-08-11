import type { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import { KnowledgeItemNotFoundError } from "../domain/errors";
import type { KnowledgeItem } from "../domain/knowledge-item.entity";
import { FakeKnowledgeRepository } from "./__fakes__/fake-knowledge-repository";
import { FakeTenantContextService } from "./__fakes__/fake-tenant-context";
import { GetKnowledgeItemUseCase } from "./get-knowledge-item.use-case";

function buildUseCase(knowledgeRepository = new FakeKnowledgeRepository()) {
  return {
    useCase: new GetKnowledgeItemUseCase(
      new FakeTenantContextService() as unknown as TenantContextService,
      knowledgeRepository,
    ),
    knowledgeRepository,
  };
}

function seedItem(
  repository: FakeKnowledgeRepository,
  overrides: Partial<KnowledgeItem> = {},
): KnowledgeItem {
  const now = new Date();
  const item: KnowledgeItem = {
    id: "item-1",
    tenantId: "tenant-1",
    businessId: "business-1",
    category: "pricing",
    title: "Title",
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
  repository.seed(item);
  return item;
}

describe("GetKnowledgeItemUseCase", () => {
  it("returns the item for the tenant that owns it", async () => {
    const { useCase, knowledgeRepository } = buildUseCase();
    seedItem(knowledgeRepository);

    const item = await useCase.execute("tenant-1", "item-1");

    expect(item.id).toBe("item-1");
  });

  it("throws KnowledgeItemNotFoundError for an unknown id", async () => {
    const { useCase } = buildUseCase();

    await expect(useCase.execute("tenant-1", "unknown")).rejects.toThrow(
      KnowledgeItemNotFoundError,
    );
  });

  it("tenant isolation: never returns another tenant's item", async () => {
    const { useCase, knowledgeRepository } = buildUseCase();
    seedItem(knowledgeRepository, { tenantId: "tenant-1" });

    await expect(useCase.execute("tenant-2", "item-1")).rejects.toThrow(KnowledgeItemNotFoundError);
  });
});
