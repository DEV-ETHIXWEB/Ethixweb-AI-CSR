import type { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import {
  InvalidKnowledgeLifecycleTransitionError,
  KnowledgeItemNotFoundError,
} from "../domain/errors";
import type { KnowledgeItem } from "../domain/knowledge-item.entity";
import { FakeAuditLogRepository } from "./__fakes__/fake-audit-log-repository";
import { FakeKnowledgeRepository } from "./__fakes__/fake-knowledge-repository";
import { FakeTenantContextService } from "./__fakes__/fake-tenant-context";
import { DisableKnowledgeItemUseCase } from "./disable-knowledge-item.use-case";

function buildUseCase(
  knowledgeRepository = new FakeKnowledgeRepository(),
  auditLogRepository = new FakeAuditLogRepository(),
) {
  return {
    useCase: new DisableKnowledgeItemUseCase(
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

describe("DisableKnowledgeItemUseCase", () => {
  it("disables an item from draft", async () => {
    const { useCase, knowledgeRepository } = buildUseCase();
    seedItem(knowledgeRepository, { status: "draft" });

    const disabled = await useCase.execute({
      tenantId: "tenant-1",
      itemId: "item-1",
      actorUserId: "user-2",
    });

    expect(disabled.status).toBe("disabled");
  });

  it("disables an item from approved", async () => {
    const { useCase, knowledgeRepository } = buildUseCase();
    seedItem(knowledgeRepository, { status: "approved" });

    const disabled = await useCase.execute({
      tenantId: "tenant-1",
      itemId: "item-1",
      actorUserId: "user-2",
    });

    expect(disabled.status).toBe("disabled");
  });

  it("throws InvalidKnowledgeLifecycleTransitionError when disabling an already-disabled item", async () => {
    const { useCase, knowledgeRepository } = buildUseCase();
    seedItem(knowledgeRepository, { status: "disabled" });

    await expect(
      useCase.execute({ tenantId: "tenant-1", itemId: "item-1", actorUserId: "user-2" }),
    ).rejects.toThrow(InvalidKnowledgeLifecycleTransitionError);
  });

  it("throws KnowledgeItemNotFoundError for a missing item", async () => {
    const { useCase } = buildUseCase();

    await expect(
      useCase.execute({ tenantId: "tenant-1", itemId: "missing", actorUserId: "user-2" }),
    ).rejects.toThrow(KnowledgeItemNotFoundError);
  });

  it("writes an AuditLog entry with action knowledge.disabled", async () => {
    const { useCase, knowledgeRepository, auditLogRepository } = buildUseCase();
    seedItem(knowledgeRepository, { status: "draft" });

    await useCase.execute({ tenantId: "tenant-1", itemId: "item-1", actorUserId: "user-2" });

    expect(auditLogRepository.entries).toHaveLength(1);
    expect(auditLogRepository.entries[0]).toMatchObject({
      tenantId: "tenant-1",
      actorId: "user-2",
      actorType: "user",
      action: "knowledge.disabled",
      resourceType: "knowledge_item",
      resourceId: "item-1",
    });
  });
});
