import { Inject, Injectable } from "@nestjs/common";
import { setSpanAttributes } from "../../../shared/observability/tracing";
import { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import type { KnowledgeItem } from "../domain/knowledge-item.entity";
import {
  KNOWLEDGE_REPOSITORY,
  type KnowledgeRepository,
} from "../domain/ports/knowledge-repository.port";

/** No `status` field — CreateKnowledgeItemUseCase always creates in draft, regardless of anything a caller might try to pass; PrismaKnowledgeRepository.create hardcodes `status: "draft"` at the write itself, so there is no way to bypass this even at the repository layer. */
export interface CreateKnowledgeItemCommand {
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

@Injectable()
export class CreateKnowledgeItemUseCase {
  constructor(
    private readonly tenantContext: TenantContextService,
    @Inject(KNOWLEDGE_REPOSITORY) private readonly knowledgeRepository: KnowledgeRepository,
  ) {}

  async execute(command: CreateKnowledgeItemCommand): Promise<KnowledgeItem> {
    setSpanAttributes({
      "ethixweb.tenant_id": command.tenantId,
      "ethixweb.business_id": command.businessId,
    });

    return this.tenantContext.run(command.tenantId, (db) =>
      this.knowledgeRepository.create(db, {
        tenantId: command.tenantId,
        businessId: command.businessId,
        category: command.category,
        title: command.title,
        content: command.content,
        aiKnowledge: command.aiKnowledge,
        waitingBrochure: command.waitingBrochure,
        priority: command.priority,
        createdByUserId: command.createdByUserId,
      }),
    );
  }
}
