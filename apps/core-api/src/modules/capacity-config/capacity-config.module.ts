import { Module } from "@nestjs/common";
import { AUDIT_LOG_REPOSITORY } from "../../shared/audit/audit-log-repository.port";
import { PrismaAuditLogRepository } from "../../shared/audit/prisma-audit-log.repository";
import { GetCapacityConfigUseCase } from "./application/get-capacity-config.use-case";
import { UpsertCapacityConfigUseCase } from "./application/upsert-capacity-config.use-case";
import { CAPACITY_CONFIG_REPOSITORY } from "./domain/ports/capacity-config-repository.port";
import { PrismaCapacityConfigRepository } from "./infrastructure/prisma-capacity-config.repository";
import { CapacityConfigController } from "./interfaces/capacity-config.controller";
import { CapacityConfigToolController } from "./interfaces/capacity-config-tool.controller";

@Module({
  controllers: [CapacityConfigController, CapacityConfigToolController],
  providers: [
    { provide: CAPACITY_CONFIG_REPOSITORY, useClass: PrismaCapacityConfigRepository },
    // Same reasoning as KnowledgeModule's own copy of this line — see that
    // module's comment.
    { provide: AUDIT_LOG_REPOSITORY, useClass: PrismaAuditLogRepository },
    GetCapacityConfigUseCase,
    UpsertCapacityConfigUseCase,
  ],
  exports: [GetCapacityConfigUseCase, UpsertCapacityConfigUseCase],
})
export class CapacityConfigModule {}
