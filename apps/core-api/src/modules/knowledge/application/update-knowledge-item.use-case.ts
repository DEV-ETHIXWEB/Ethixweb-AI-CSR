import { Inject, Injectable } from "@nestjs/common";
import {
  AUDIT_LOG_REPOSITORY,
  type AuditLogRepository,
} from "../../../shared/audit/audit-log-repository.port";
import { setSpanAttributes } from "../../../shared/observability/tracing";
import { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import { KnowledgeItemNotFoundError } from "../domain/errors";
import type { KnowledgeItem } from "../domain/knowledge-item.entity";
import {
  KNOWLEDGE_REPOSITORY,
  type KnowledgeRepository,
} from "../domain/ports/knowledge-repository.port";

export interface UpdateKnowledgeItemPatch {
  title?: string | undefined;
  content?: string | undefined;
  category?: string | undefined;
  aiKnowledge?: boolean | undefined;
  waitingBrochure?: boolean | undefined;
  priority?: number | undefined;
}

export interface UpdateKnowledgeItemCommand {
  tenantId: string;
  itemId: string;
  actorUserId: string | null;
  patch: UpdateKnowledgeItemPatch;
}

/**
 * docs/38's safety property: editing the CONTENT of an already-approved
 * item must revert it to draft — an approved item is a promise that a
 * human reviewed exactly this text, and any content change breaks that
 * promise until it's reviewed again. Editing non-content fields
 * (category/aiKnowledge/waitingBrochure/priority) on an approved item does
 * NOT revert it — those are display/routing metadata, not the reviewed
 * substance, so an approved item stays approved when only those change.
 * "Content changed" is a real value comparison (patch.content !== existing
 * content), not "content was present in the patch" — a caller resubmitting
 * the SAME content unchanged must not trigger a revert either.
 */
@Injectable()
export class UpdateKnowledgeItemUseCase {
  constructor(
    private readonly tenantContext: TenantContextService,
    @Inject(KNOWLEDGE_REPOSITORY) private readonly knowledgeRepository: KnowledgeRepository,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly auditLogRepository: AuditLogRepository,
  ) {}

  async execute(command: UpdateKnowledgeItemCommand): Promise<KnowledgeItem> {
    setSpanAttributes({
      "ethixweb.tenant_id": command.tenantId,
      "ethixweb.knowledge_item_id": command.itemId,
    });

    return this.tenantContext.run(command.tenantId, async (db) => {
      const existing = await this.knowledgeRepository.findById(
        db,
        command.tenantId,
        command.itemId,
      );
      if (!existing) {
        throw new KnowledgeItemNotFoundError(command.itemId);
      }

      const contentChanged =
        command.patch.content !== undefined && command.patch.content !== existing.content;
      const shouldRevertToDraft = existing.status === "approved" && contentChanged;

      const updated = await this.knowledgeRepository.updateFields(
        db,
        command.tenantId,
        command.itemId,
        {
          title: command.patch.title,
          content: command.patch.content,
          category: command.patch.category,
          aiKnowledge: command.patch.aiKnowledge,
          waitingBrochure: command.patch.waitingBrochure,
          priority: command.patch.priority,
          updatedByUserId: command.actorUserId,
          status: shouldRevertToDraft ? "draft" : undefined,
        },
      );

      await this.auditLogRepository.record(db, {
        tenantId: command.tenantId,
        actorId: command.actorUserId,
        actorType: "user",
        action: "knowledge.updated",
        resourceType: "knowledge_item",
        resourceId: updated.id,
        before: existing,
        after: updated,
      });

      return updated;
    });
  }
}
