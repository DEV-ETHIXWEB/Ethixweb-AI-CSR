import type { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import { FakeKnowledgeRepository } from "./__fakes__/fake-knowledge-repository";
import { FakeTenantContextService } from "./__fakes__/fake-tenant-context";
import { CreateKnowledgeItemUseCase } from "./create-knowledge-item.use-case";

function buildUseCase(knowledgeRepository = new FakeKnowledgeRepository()) {
  return {
    useCase: new CreateKnowledgeItemUseCase(
      new FakeTenantContextService() as unknown as TenantContextService,
      knowledgeRepository,
    ),
    knowledgeRepository,
  };
}

describe("CreateKnowledgeItemUseCase", () => {
  it("always creates a new item in draft status, regardless of any status-like input", async () => {
    const { useCase } = buildUseCase();

    const item = await useCase.execute({
      tenantId: "tenant-1",
      businessId: "business-1",
      category: "pricing",
      title: "Service call fee",
      content: "Our standard service call fee is $89.",
      aiKnowledge: true,
      waitingBrochure: false,
      priority: 1,
      createdByUserId: "user-1",
    });

    expect(item.status).toBe("draft");
    expect(item.title).toBe("Service call fee");
    expect(item.createdByUserId).toBe("user-1");
    expect(item.approvedByUserId).toBeNull();
    expect(item.approvedAt).toBeNull();
  });

  it("persists the item so it is retrievable via the repository", async () => {
    const { useCase, knowledgeRepository } = buildUseCase();

    const item = await useCase.execute({
      tenantId: "tenant-1",
      businessId: "business-1",
      category: "hours",
      title: "Business hours",
      content: "Mon-Fri 8am-6pm",
      aiKnowledge: true,
      waitingBrochure: true,
      priority: 0,
      createdByUserId: null,
    });

    const found = await knowledgeRepository.findById(undefined as never, "tenant-1", item.id);
    expect(found).not.toBeNull();
    expect(found?.status).toBe("draft");
  });
});
