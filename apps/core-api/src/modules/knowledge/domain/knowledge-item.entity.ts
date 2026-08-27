/**
 * docs/06-database-schema.md KNOWLEDGE_ITEMS / docs/38's "AI Knowledge" +
 * "Waiting/Brochure Knowledge" fields. `Date`, not `string`, for the
 * timestamp fields — matching leads/domain/lead.entity.ts's convention
 * (both are CRUD entities with a status lifecycle, created/edited through
 * dashboard use cases), not calls/domain/call.entity.ts's `string`
 * convention (that one is tied to Call's telephony-webhook-driven design,
 * where the wire payload IS an ISO string end to end). See this module's
 * PrismaKnowledgeRepository for where the Prisma `Date` -> entity `Date`
 * mapping happens (a pass-through, not a conversion, unlike Call's
 * `.toISOString()` step).
 */
export const KNOWLEDGE_ITEM_STATUSES = ["draft", "approved", "disabled"] as const;
export type KnowledgeItemStatus = (typeof KNOWLEDGE_ITEM_STATUSES)[number];

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
  approvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
