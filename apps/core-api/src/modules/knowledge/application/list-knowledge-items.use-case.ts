import { Inject, Injectable } from "@nestjs/common";
import { setSpanAttributes } from "../../../shared/observability/tracing";
import { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import type { KnowledgeItemStatus } from "../domain/knowledge-item.entity";
import {
  KNOWLEDGE_REPOSITORY,
  type KnowledgeRepository,
  type ListKnowledgeResult,
} from "../domain/ports/knowledge-repository.port";

export interface ListKnowledgeItemsQuery {
  tenantId: string;
  businessId: string;
  page: number;
  pageSize: number;
  status?: KnowledgeItemStatus | undefined;
  category?: string | undefined;
  aiKnowledge?: boolean | undefined;
  waitingBrochure?: boolean | undefined;
}

/** Dispatcher-facing knowledge inbox — list/filter, mirrors ListLeadsUseCase exactly. */
@Injectable()
export class ListKnowledgeItemsUseCase {
  constructor(
    private readonly tenantContext: TenantContextService,
    @Inject(KNOWLEDGE_REPOSITORY) private readonly knowledgeRepository: KnowledgeRepository,
  ) {}

  async execute(query: ListKnowledgeItemsQuery): Promise<ListKnowledgeResult> {
    setSpanAttributes({
      "ethixweb.tenant_id": query.tenantId,
      "ethixweb.business_id": query.businessId,
    });

    return this.tenantContext.run(query.tenantId, (db) =>
      this.knowledgeRepository.listByBusiness(db, query.tenantId, query.businessId, {
        page: query.page,
        pageSize: query.pageSize,
        status: query.status,
        category: query.category,
        aiKnowledge: query.aiKnowledge,
        waitingBrochure: query.waitingBrochure,
      }),
    );
  }
}
