import { Inject, Injectable } from "@nestjs/common";
import {
  AUDIT_LOG_REPOSITORY,
  type AuditLogRepository,
} from "../../../shared/audit/audit-log-repository.port";
import { setSpanAttributes } from "../../../shared/observability/tracing";
import { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import { KnowledgeItemNotFoundError } from "../domain/errors";
import type { KnowledgeItem } from "../domain/knowledge-item.entity";
import { assertValidKnowledgeStatusTransition } from "../domain/knowledge-lifecycle";
import {
  KNOWLEDGE_REPOSITORY,
  type KnowledgeRepository,
} from "../domain/ports/knowledge-repository.port";

export interface DisableKnowledgeItemCommand {
  tenantId: string;
  itemId: string;
  actorUserId: string | null;
}

@Injectable()
export class DisableKnowledgeItemUseCase {
  constructor(
    private readonly tenantContext: TenantContextService,
    @Inject(KNOWLEDGE_REPOSITORY) private readonly knowledgeRepository: KnowledgeRepository,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly auditLogRepository: AuditLogRepository,
  ) {}

  async execute(command: DisableKnowledgeItemCommand): Promise<KnowledgeItem> {
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
      assertValidKnowledgeStatusTransition(command.itemId, existing.status, "disabled");

      const updated = await this.knowledgeRepository.updateStatus(
        db,
        command.tenantId,
        command.itemId,
        {
          status: "disabled",
        },
      );

      await this.auditLogRepository.record(db, {
        tenantId: command.tenantId,
        actorId: command.actorUserId,
        actorType: "user",
        action: "knowledge.disabled",
        resourceType: "knowledge_item",
        resourceId: updated.id,
        before: existing,
        after: updated,
      });

      return updated;
    });
  }
}
