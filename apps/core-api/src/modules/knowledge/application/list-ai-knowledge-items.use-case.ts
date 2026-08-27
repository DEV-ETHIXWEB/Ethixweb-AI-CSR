import { Inject, Injectable } from "@nestjs/common";
import { setSpanAttributes } from "../../../shared/observability/tracing";
import { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import type { KnowledgeItem } from "../domain/knowledge-item.entity";
import {
  KNOWLEDGE_REPOSITORY,
  type KnowledgeRepository,
} from "../domain/ports/knowledge-repository.port";

/**
 * voice-orchestrator's runtime-facing read path for approved general AI
 * knowledge (docs/38) — the sibling of ListWaitingBrochureItemsUseCase,
 * same shape, filtering `aiKnowledge` instead of `waitingBrochure`. Approved
 * items only, ordered by `priority` ascending, via the same
 * `listApprovedForRuntime` repository method that already supports this
 * filter (it takes `{aiKnowledge, waitingBrochure}` independently — no
 * repository change needed for this use case to exist).
 */
@Injectable()
export class ListAiKnowledgeItemsUseCase {
  constructor(
    private readonly tenantContext: TenantContextService,
    @Inject(KNOWLEDGE_REPOSITORY) private readonly knowledgeRepository: KnowledgeRepository,
  ) {}

  async execute(tenantId: string, businessId: string): Promise<KnowledgeItem[]> {
    setSpanAttributes({ "ethixweb.tenant_id": tenantId, "ethixweb.business_id": businessId });
    return this.tenantContext.run(tenantId, (db) =>
      this.knowledgeRepository.listApprovedForRuntime(db, tenantId, businessId, {
        aiKnowledge: true,
      }),
    );
  }
}
