import type { Prisma, PrismaClient } from "@ethixweb/database";
import type { KnowledgeItem, KnowledgeItemStatus } from "../knowledge-item.entity";

export type Db = PrismaClient | Prisma.TransactionClient;

export interface CreateKnowledgeItemInput {
  tenantId: string;
  businessId: string;
  category: string;
  title: string;
  content: string;
  aiKnowledge: boolean;
  waitingBrochure: boolean;
  priority: number;
  createdByUserId: string | null;
}

/**
 * Content/config fields only, PLUS an optional `status` override — used by
 * UpdateKnowledgeItemUseCase for the single atomic write that both patches
 * content and (when the approved-content-changed auto-revert rule fires)
 * forces status back to draft in the SAME write, rather than two
 * sequential repo calls with a partial-failure window between them. Not
 * used by Approve/Disable — those go through `updateStatus` below, which
 * carries no content fields at all.
 */
export interface UpdateKnowledgeItemFieldsInput {
  title?: string | undefined;
  content?: string | undefined;
  category?: string | undefined;
  aiKnowledge?: boolean | undefined;
  waitingBrochure?: boolean | undefined;
  priority?: number | undefined;
  updatedByUserId: string | null;
  /** Set only by UpdateKnowledgeItemUseCase's auto-revert rule — never caller-supplied as a general "change status via update" escape hatch. */
  status?: KnowledgeItemStatus | undefined;
}

export interface UpdateKnowledgeItemStatusInput {
  status: KnowledgeItemStatus;
  approvedByUserId?: string | null | undefined;
  approvedAt?: Date | null | undefined;
}

export interface ListKnowledgeOptions {
  page: number;
  pageSize: number;
  status?: KnowledgeItemStatus | undefined;
  category?: string | undefined;
  aiKnowledge?: boolean | undefined;
  waitingBrochure?: boolean | undefined;
}

export interface ListKnowledgeResult {
  items: KnowledgeItem[];
  total: number;
}

export interface ListApprovedForRuntimeOptions {
  aiKnowledge?: boolean | undefined;
  waitingBrochure?: boolean | undefined;
}

export interface KnowledgeRepository {
  create(db: Db, input: CreateKnowledgeItemInput): Promise<KnowledgeItem>;
  findById(db: Db, tenantId: string, id: string): Promise<KnowledgeItem | null>;
  /** Content/config patch, optionally also forcing `status` (the approved-content-changed auto-revert) in the same write — see UpdateKnowledgeItemFieldsInput's own comment. */
  updateFields(
    db: Db,
    tenantId: string,
    id: string,
    patch: UpdateKnowledgeItemFieldsInput,
  ): Promise<KnowledgeItem>;
  /** Pure status + approval-metadata change, no content fields — Approve/Disable's exclusive write path. */
  updateStatus(
    db: Db,
    tenantId: string,
    id: string,
    fields: UpdateKnowledgeItemStatusInput,
  ): Promise<KnowledgeItem>;
  listByBusiness(
    db: Db,
    tenantId: string,
    businessId: string,
    options: ListKnowledgeOptions,
  ): Promise<ListKnowledgeResult>;
  /** Approved items only, for the internal runtime-facing read paths (AI knowledge lookup / waiting-brochure). */
  listApprovedForRuntime(
    db: Db,
    tenantId: string,
    businessId: string,
    options: ListApprovedForRuntimeOptions,
  ): Promise<KnowledgeItem[]>;
}

export const KNOWLEDGE_REPOSITORY = Symbol("KNOWLEDGE_REPOSITORY");
