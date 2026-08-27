import { Inject, Injectable } from "@nestjs/common";
import { setSpanAttributes } from "../../../shared/observability/tracing";
import { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import { KnowledgeItemNotFoundError } from "../domain/errors";
import type { KnowledgeItem } from "../domain/knowledge-item.entity";
import {
  KNOWLEDGE_REPOSITORY,
  type KnowledgeRepository,
} from "../domain/ports/knowledge-repository.port";

@Injectable()
export class GetKnowledgeItemUseCase {
  constructor(
    private readonly tenantContext: TenantContextService,
    @Inject(KNOWLEDGE_REPOSITORY) private readonly knowledgeRepository: KnowledgeRepository,
  ) {}

  async execute(tenantId: string, id: string): Promise<KnowledgeItem> {
    setSpanAttributes({ "ethixweb.tenant_id": tenantId, "ethixweb.knowledge_item_id": id });
    const item = await this.tenantContext.run(tenantId, (db) =>
      this.knowledgeRepository.findById(db, tenantId, id),
    );
    if (!item) {
      throw new KnowledgeItemNotFoundError(id);
    }
    return item;
  }
}
