import { Injectable } from "@nestjs/common";
import type { Prisma } from "@ethixweb/database";
import type { KnowledgeItem, KnowledgeItemStatus } from "../domain/knowledge-item.entity";
import type {
  CreateKnowledgeItemInput,
  Db,
  KnowledgeRepository,
  ListApprovedForRuntimeOptions,
  ListKnowledgeOptions,
  ListKnowledgeResult,
  UpdateKnowledgeItemFieldsInput,
  UpdateKnowledgeItemStatusInput,
} from "../domain/ports/knowledge-repository.port";

type KnowledgeItemRow = {
  id: string;
  tenantId: string;
  businessId: string;
  category: string;
  title: string;
  content: string;
  status: string;
  aiKnowledge: boolean;
  waitingBrochure: boolean;
  priority: number;
  createdByUserId: string | null;
  updatedByUserId: string | null;
  approvedByUserId: string | null;
  approvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function toEntity(row: KnowledgeItemRow): KnowledgeItem {
  return {
    id: row.id,
    tenantId: row.tenantId,
    businessId: row.businessId,
    category: row.category,
    title: row.title,
    content: row.content,
    status: row.status as KnowledgeItemStatus,
    aiKnowledge: row.aiKnowledge,
    waitingBrochure: row.waitingBrochure,
    priority: row.priority,
    createdByUserId: row.createdByUserId,
    updatedByUserId: row.updatedByUserId,
    approvedByUserId: row.approvedByUserId,
    approvedAt: row.approvedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

@Injectable()
export class PrismaKnowledgeRepository implements KnowledgeRepository {
  async create(db: Db, input: CreateKnowledgeItemInput): Promise<KnowledgeItem> {
    const row = await db.knowledgeItem.create({
      data: {
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
      },
    });
    return toEntity(row);
  }

  async findById(db: Db, tenantId: string, id: string): Promise<KnowledgeItem | null> {
    const row = await db.knowledgeItem.findFirst({ where: { id, tenantId } });
    return row ? toEntity(row) : null;
  }

  async updateFields(
    db: Db,
    tenantId: string,
    id: string,
    patch: UpdateKnowledgeItemFieldsInput,
  ): Promise<KnowledgeItem> {
    const data: Prisma.KnowledgeItemUpdateManyMutationInput = {
      updatedByUserId: patch.updatedByUserId,
    };
    if (patch.title !== undefined) {
      data.title = patch.title;
    }
    if (patch.content !== undefined) {
      data.content = patch.content;
    }
    if (patch.category !== undefined) {
      data.category = patch.category;
    }
    if (patch.aiKnowledge !== undefined) {
      data.aiKnowledge = patch.aiKnowledge;
    }
    if (patch.waitingBrochure !== undefined) {
      data.waitingBrochure = patch.waitingBrochure;
    }
    if (patch.priority !== undefined) {
      data.priority = patch.priority;
    }
    if (patch.status !== undefined) {
      data.status = patch.status;
    }

    const { count } = await db.knowledgeItem.updateMany({ where: { id, tenantId }, data });
    if (count === 0) {
      throw new Error(
        `PrismaKnowledgeRepository.updateFields: no knowledge item ${id} found for tenant ${tenantId}`,
      );
    }
    return this.mustFind(db, tenantId, id, "updateFields");
  }

  async updateStatus(
    db: Db,
    tenantId: string,
    id: string,
    fields: UpdateKnowledgeItemStatusInput,
  ): Promise<KnowledgeItem> {
    const { count } = await db.knowledgeItem.updateMany({
      where: { id, tenantId },
      data: {
        status: fields.status,
        ...(fields.approvedByUserId !== undefined
          ? { approvedByUserId: fields.approvedByUserId }
          : {}),
        ...(fields.approvedAt !== undefined ? { approvedAt: fields.approvedAt } : {}),
      },
    });
    if (count === 0) {
      throw new Error(
        `PrismaKnowledgeRepository.updateStatus: no knowledge item ${id} found for tenant ${tenantId}`,
      );
    }
    return this.mustFind(db, tenantId, id, "updateStatus");
  }

  async listByBusiness(
    db: Db,
    tenantId: string,
    businessId: string,
    options: ListKnowledgeOptions,
  ): Promise<ListKnowledgeResult> {
    const where: Prisma.KnowledgeItemWhereInput = {
      tenantId,
      businessId,
      ...(options.status ? { status: options.status } : {}),
      ...(options.category ? { category: options.category } : {}),
      ...(options.aiKnowledge !== undefined ? { aiKnowledge: options.aiKnowledge } : {}),
      ...(options.waitingBrochure !== undefined
        ? { waitingBrochure: options.waitingBrochure }
        : {}),
    };

    const [rows, total] = await Promise.all([
      db.knowledgeItem.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (options.page - 1) * options.pageSize,
        take: options.pageSize,
      }),
      db.knowledgeItem.count({ where }),
    ]);

    return { items: rows.map(toEntity), total };
  }

  async listApprovedForRuntime(
    db: Db,
    tenantId: string,
    businessId: string,
    options: ListApprovedForRuntimeOptions,
  ): Promise<KnowledgeItem[]> {
    const rows = await db.knowledgeItem.findMany({
      where: {
        tenantId,
        businessId,
        status: "approved",
        ...(options.aiKnowledge !== undefined ? { aiKnowledge: options.aiKnowledge } : {}),
        ...(options.waitingBrochure !== undefined
          ? { waitingBrochure: options.waitingBrochure }
          : {}),
      },
      orderBy: { priority: "asc" },
    });
    return rows.map(toEntity);
  }

  private async mustFind(
    db: Db,
    tenantId: string,
    id: string,
    caller: string,
  ): Promise<KnowledgeItem> {
    const updated = await db.knowledgeItem.findFirst({ where: { id, tenantId } });
    if (!updated) {
      throw new Error(
        `PrismaKnowledgeRepository.${caller}: knowledge item ${id} vanished after update`,
      );
    }
    return toEntity(updated);
  }
}
