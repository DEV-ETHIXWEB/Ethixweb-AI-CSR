import { Inject, Injectable } from "@nestjs/common";
import { setSpanAttributes } from "../../../shared/observability/tracing";
import { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import type { KnowledgeItem } from "../domain/knowledge-item.entity";
import {
  KNOWLEDGE_REPOSITORY,
  type KnowledgeRepository,
} from "../domain/ports/knowledge-repository.port";

/**
 * voice-orchestrator's runtime-facing read path for the waiting/brochure
 * experience (docs/36) — approved items flagged `waitingBrochure`, ordered
 * by `priority` ascending (lower sorts first, per the Prisma schema's own
 * field comment). Goes through a dedicated use case rather than
 * KnowledgeToolController injecting the repository directly: every other
 * internal/* controller in this codebase (UsageToolController,
 * CallsToolController, LeadsToolController, EmergencyRulesToolController's
 * escalate/business-hours routes) calls into a use case, not a repository
 * — EmergencyRulesController's OWN direct-repo-injection is the one
 * outlier among tenant-facing controllers, not the internal/* norm.
 */
@Injectable()
export class ListWaitingBrochureItemsUseCase {
  constructor(
    private readonly tenantContext: TenantContextService,
    @Inject(KNOWLEDGE_REPOSITORY) private readonly knowledgeRepository: KnowledgeRepository,
  ) {}

  async execute(tenantId: string, businessId: string): Promise<KnowledgeItem[]> {
    setSpanAttributes({ "ethixweb.tenant_id": tenantId, "ethixweb.business_id": businessId });
    return this.tenantContext.run(tenantId, (db) =>
      this.knowledgeRepository.listApprovedForRuntime(db, tenantId, businessId, {
        waitingBrochure: true,
      }),
    );
  }
}
