import type { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import { KnowledgeItemNotFoundError } from "../domain/errors";
import type { KnowledgeItem } from "../domain/knowledge-item.entity";
import { FakeAuditLogRepository } from "./__fakes__/fake-audit-log-repository";
import { FakeKnowledgeRepository } from "./__fakes__/fake-knowledge-repository";
import { FakeTenantContextService } from "./__fakes__/fake-tenant-context";
import { UpdateKnowledgeItemUseCase } from "./update-knowledge-item.use-case";

function buildUseCase(
  knowledgeRepository = new FakeKnowledgeRepository(),
  auditLogRepository = new FakeAuditLogRepository(),
) {
  return {
    useCase: new UpdateKnowledgeItemUseCase(
      new FakeTenantContextService() as unknown as TenantContextService,
      knowledgeRepository,
      auditLogRepository,
    ),
    knowledgeRepository,
    auditLogRepository,
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
    title: "Service call fee",
    content: "Our standard service call fee is $89.",
    status: "draft",
    aiKnowledge: true,
    waitingBrochure: false,
    priority: 0,
    createdByUserId: "user-1",
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

describe("UpdateKnowledgeItemUseCase", () => {
  it("applies a partial patch to mutable fields", async () => {
    const { useCase, knowledgeRepository } = buildUseCase();
    seedItem(knowledgeRepository);

    const updated = await useCase.execute({
      tenantId: "tenant-1",
      itemId: "item-1",
      actorUserId: "user-2",
      patch: { title: "Updated title" },
    });

    expect(updated.title).toBe("Updated title");
    expect(updated.content).toBe("Our standard service call fee is $89.");
    expect(updated.updatedByUserId).toBe("user-2");
  });

  it("throws KnowledgeItemNotFoundError for an item that doesn't exist", async () => {
    const { useCase } = buildUseCase();

    await expect(
      useCase.execute({
        tenantId: "tenant-1",
        itemId: "missing",
        actorUserId: "user-1",
        patch: {},
      }),
    ).rejects.toThrow(KnowledgeItemNotFoundError);
  });

  describe("approved-content-change auto-revert", () => {
    it("reverts an approved item to draft when its CONTENT is edited", async () => {
      const { useCase, knowledgeRepository } = buildUseCase();
      seedItem(knowledgeRepository, {
        status: "approved",
        approvedByUserId: "user-1",
        approvedAt: new Date(),
      });

      const updated = await useCase.execute({
        tenantId: "tenant-1",
        itemId: "item-1",
        actorUserId: "user-2",
        patch: { content: "Our NEW service call fee is $99." },
      });

      expect(updated.status).toBe("draft");
      expect(updated.content).toBe("Our NEW service call fee is $99.");
    });

    it("does NOT revert an approved item when only non-content fields (priority/category) are edited", async () => {
      const { useCase, knowledgeRepository } = buildUseCase();
      seedItem(knowledgeRepository, { status: "approved" });

      const updated = await useCase.execute({
        tenantId: "tenant-1",
        itemId: "item-1",
        actorUserId: "user-2",
        patch: { priority: 5, category: "fees" },
      });

      expect(updated.status).toBe("approved");
      expect(updated.priority).toBe(5);
      expect(updated.category).toBe("fees");
    });

    it("does NOT revert when content is resubmitted UNCHANGED", async () => {
      const { useCase, knowledgeRepository } = buildUseCase();
      const original = seedItem(knowledgeRepository, { status: "approved" });

      const updated = await useCase.execute({
        tenantId: "tenant-1",
        itemId: "item-1",
        actorUserId: "user-2",
        patch: { content: original.content },
      });

      expect(updated.status).toBe("approved");
    });

    it("does not revert a draft item (already draft, nothing to revert)", async () => {
      const { useCase, knowledgeRepository } = buildUseCase();
      seedItem(knowledgeRepository, { status: "draft" });

      const updated = await useCase.execute({
        tenantId: "tenant-1",
        itemId: "item-1",
        actorUserId: "user-2",
        patch: { content: "Changed content" },
      });

      expect(updated.status).toBe("draft");
    });
  });

  it("writes an AuditLog entry with the correct actor/action/resource fields", async () => {
    const { useCase, knowledgeRepository, auditLogRepository } = buildUseCase();
    seedItem(knowledgeRepository);

    await useCase.execute({
      tenantId: "tenant-1",
      itemId: "item-1",
      actorUserId: "user-2",
      patch: { title: "New title" },
    });

    expect(auditLogRepository.entries).toHaveLength(1);
    expect(auditLogRepository.entries[0]).toMatchObject({
      tenantId: "tenant-1",
      actorId: "user-2",
      actorType: "user",
      action: "knowledge.updated",
      resourceType: "knowledge_item",
      resourceId: "item-1",
    });
  });
});
