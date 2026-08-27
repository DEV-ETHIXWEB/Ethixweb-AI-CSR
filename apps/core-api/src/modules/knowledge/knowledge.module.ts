import { Module } from "@nestjs/common";
import { AUDIT_LOG_REPOSITORY } from "../../shared/audit/audit-log-repository.port";
import { PrismaAuditLogRepository } from "../../shared/audit/prisma-audit-log.repository";
import { ApproveKnowledgeItemUseCase } from "./application/approve-knowledge-item.use-case";
import { CreateKnowledgeItemUseCase } from "./application/create-knowledge-item.use-case";
import { DisableKnowledgeItemUseCase } from "./application/disable-knowledge-item.use-case";
import { GetKnowledgeItemUseCase } from "./application/get-knowledge-item.use-case";
import { ListAiKnowledgeItemsUseCase } from "./application/list-ai-knowledge-items.use-case";
import { ListKnowledgeItemsUseCase } from "./application/list-knowledge-items.use-case";
import { ListWaitingBrochureItemsUseCase } from "./application/list-waiting-brochure-items.use-case";
import { UpdateKnowledgeItemUseCase } from "./application/update-knowledge-item.use-case";
import { KNOWLEDGE_REPOSITORY } from "./domain/ports/knowledge-repository.port";
import { PrismaKnowledgeRepository } from "./infrastructure/prisma-knowledge.repository";
import { KnowledgeController } from "./interfaces/knowledge.controller";
import { KnowledgeToolController } from "./interfaces/knowledge-tool.controller";

@Module({
  controllers: [KnowledgeController, KnowledgeToolController],
  providers: [
    { provide: KNOWLEDGE_REPOSITORY, useClass: PrismaKnowledgeRepository },
    // No cross-module export of AUDIT_LOG_REPOSITORY exists yet (see
    // shared/audit/audit-log-repository.port.ts's own comment) — provided
    // directly here, and again in CapacityConfigModule, rather than
    // reaching into a sibling module for something neither advertises as
    // shared. Cheap: PrismaAuditLogRepository carries no state.
    { provide: AUDIT_LOG_REPOSITORY, useClass: PrismaAuditLogRepository },
    CreateKnowledgeItemUseCase,
    UpdateKnowledgeItemUseCase,
    ApproveKnowledgeItemUseCase,
    DisableKnowledgeItemUseCase,
    GetKnowledgeItemUseCase,
    ListKnowledgeItemsUseCase,
    ListWaitingBrochureItemsUseCase,
    ListAiKnowledgeItemsUseCase,
  ],
  exports: [
    CreateKnowledgeItemUseCase,
    UpdateKnowledgeItemUseCase,
    ApproveKnowledgeItemUseCase,
    DisableKnowledgeItemUseCase,
    GetKnowledgeItemUseCase,
    ListKnowledgeItemsUseCase,
    ListWaitingBrochureItemsUseCase,
    ListAiKnowledgeItemsUseCase,
  ],
})
export class KnowledgeModule {}
