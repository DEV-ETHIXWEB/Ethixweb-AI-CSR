import { Module } from "@nestjs/common";
import { EscalateEmergencyUseCase } from "./application/escalate-emergency.use-case";
import { GetBusinessHoursUseCase } from "./application/get-business-hours.use-case";
import { ResolveOnCallUseCase } from "./application/resolve-oncall.use-case";
import { BUSINESS_HOUR_REPOSITORY } from "./domain/ports/business-hour-repository.port";
import { EMERGENCY_RULE_REPOSITORY } from "./domain/ports/emergency-rule-repository.port";
import { ONCALL_REPOSITORY } from "./domain/ports/oncall-repository.port";
import { PrismaBusinessHourRepository } from "./infrastructure/prisma-business-hour.repository";
import { PrismaEmergencyRuleRepository } from "./infrastructure/prisma-emergency-rule.repository";
import { PrismaOnCallRepository } from "./infrastructure/prisma-oncall.repository";
import { EmergencyRulesController } from "./interfaces/emergency-rules.controller";
import { EmergencyRulesToolController } from "./interfaces/emergency-rules-tool.controller";

@Module({
  controllers: [EmergencyRulesController, EmergencyRulesToolController],
  providers: [
    { provide: EMERGENCY_RULE_REPOSITORY, useClass: PrismaEmergencyRuleRepository },
    { provide: BUSINESS_HOUR_REPOSITORY, useClass: PrismaBusinessHourRepository },
    { provide: ONCALL_REPOSITORY, useClass: PrismaOnCallRepository },
    EscalateEmergencyUseCase,
    GetBusinessHoursUseCase,
    ResolveOnCallUseCase,
  ],
  exports: [ResolveOnCallUseCase, EscalateEmergencyUseCase, GetBusinessHoursUseCase],
})
export class EmergencyRulesModule {}
