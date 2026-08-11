import { randomUUID } from "node:crypto";
import type { KnowledgeItem } from "../../domain/knowledge-item.entity";
import type {
  CreateKnowledgeItemInput,
  Db,
  KnowledgeRepository,
  ListApprovedForRuntimeOptions,
  ListKnowledgeOptions,
  ListKnowledgeResult,
  UpdateKnowledgeItemFieldsInput,
  UpdateKnowledgeItemStatusInput,
} from "../../domain/ports/knowledge-repository.port";

export class FakeKnowledgeRepository implements KnowledgeRepository {
  private readonly items = new Map<string, KnowledgeItem>();

  async create(_db: Db, input: CreateKnowledgeItemInput): Promise<KnowledgeItem> {
    const now = new Date();
    const item: KnowledgeItem = {
      id: randomUUID(),
      tenantId: input.tenantId,
      businessId: input.businessId,
      category: input.category,
      title: input.title,
      content: input.content,
      status: "draft",
      aiKnowledge: input.aiKnowledge,
      waitingBrochure: input.waitingBrochure,
      priority: input.priority,
      createdByUserId: input.createdByUserId,
      updatedByUserId: null,
      approvedByUserId: null,
      approvedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.items.set(item.id, item);
    return item;
  }

  async findById(_db: Db, tenantId: string, id: string): Promise<KnowledgeItem | null> {
    const item = this.items.get(id);
    return item && item.tenantId === tenantId ? item : null;
  }

  async updateFields(
    _db: Db,
    tenantId: string,
    id: string,
    patch: UpdateKnowledgeItemFieldsInput,
  ): Promise<KnowledgeItem> {
    const existing = this.mustFind(tenantId, id, "updateFields");
    const updated: KnowledgeItem = {
      ...existing,
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.content !== undefined ? { content: patch.content } : {}),
      ...(patch.category !== undefined ? { category: patch.category } : {}),
      ...(patch.aiKnowledge !== undefined ? { aiKnowledge: patch.aiKnowledge } : {}),
      ...(patch.waitingBrochure !== undefined ? { waitingBrochure: patch.waitingBrochure } : {}),
      ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      updatedByUserId: patch.updatedByUserId,
      updatedAt: new Date(),
    };
    this.items.set(id, updated);
    return updated;
  }

  async updateStatus(
    _db: Db,
    tenantId: string,
    id: string,
    fields: UpdateKnowledgeItemStatusInput,
  ): Promise<KnowledgeItem> {
    const existing = this.mustFind(tenantId, id, "updateStatus");
    const updated: KnowledgeItem = {
      ...existing,
      status: fields.status,
      ...(fields.approvedByUserId !== undefined
        ? { approvedByUserId: fields.approvedByUserId }
        : {}),
      ...(fields.approvedAt !== undefined ? { approvedAt: fields.approvedAt } : {}),
      updatedAt: new Date(),
    };
    this.items.set(id, updated);
    return updated;
  }

  async listByBusiness(
    _db: Db,
    tenantId: string,
    businessId: string,
    options: ListKnowledgeOptions,
  ): Promise<ListKnowledgeResult> {
    let matches = [...this.items.values()].filter(
      (item) => item.tenantId === tenantId && item.businessId === businessId,
    );
    if (options.status) {
      matches = matches.filter((item) => item.status === options.status);
    }
    if (options.category) {
      matches = matches.filter((item) => item.category === options.category);
    }
    if (options.aiKnowledge !== undefined) {
      matches = matches.filter((item) => item.aiKnowledge === options.aiKnowledge);
    }
    if (options.waitingBrochure !== undefined) {
      matches = matches.filter((item) => item.waitingBrochure === options.waitingBrochure);
    }
    matches.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const start = (options.page - 1) * options.pageSize;
    return { items: matches.slice(start, start + options.pageSize), total: matches.length };
  }

  async listApprovedForRuntime(
    _db: Db,
    tenantId: string,
    businessId: string,
    options: ListApprovedForRuntimeOptions,
  ): Promise<KnowledgeItem[]> {
    let matches = [...this.items.values()].filter(
      (item) =>
        item.tenantId === tenantId && item.businessId === businessId && item.status === "approved",
    );
    if (options.aiKnowledge !== undefined) {
      matches = matches.filter((item) => item.aiKnowledge === options.aiKnowledge);
    }
    if (options.waitingBrochure !== undefined) {
      matches = matches.filter((item) => item.waitingBrochure === options.waitingBrochure);
    }
    matches.sort((a, b) => a.priority - b.priority);
    return matches;
  }

  /** Test helper — seed an item directly, bypassing `create`. */
  seed(item: KnowledgeItem): void {
    this.items.set(item.id, item);
  }

  private mustFind(tenantId: string, id: string, caller: string): KnowledgeItem {
    const item = this.items.get(id);
    if (!item || item.tenantId !== tenantId) {
      throw new Error(
        `FakeKnowledgeRepository.${caller}: no item ${id} found for tenant ${tenantId}`,
      );
    }
    return item;
  }
}
