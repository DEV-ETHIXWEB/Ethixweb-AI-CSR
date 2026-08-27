/** Mirrors apps/core-api/src/modules/knowledge/interfaces/dto exactly. */

export type KnowledgeItemStatus = "draft" | "approved" | "disabled";

export interface KnowledgeItem {
  id: string;
  tenantId: string;
  businessId: string;
  category: string;
  title: string;
  content: string;
  status: KnowledgeItemStatus;
  aiKnowledge: boolean;
  waitingBrochure: boolean;
  priority: number;
  createdByUserId: string | null;
  updatedByUserId: string | null;
  approvedByUserId: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedKnowledge {
  items: KnowledgeItem[];
  total: number;
}
