import { Injectable } from "@nestjs/common";
import type { EmergencyRule } from "../domain/emergency-rule.entity";
import type {
  CreateEmergencyRuleInput,
  Db,
  EmergencyRuleRepository,
} from "../domain/ports/emergency-rule-repository.port";

@Injectable()
export class PrismaEmergencyRuleRepository implements EmergencyRuleRepository {
  async create(db: Db, input: CreateEmergencyRuleInput): Promise<EmergencyRule> {
    return db.emergencyRule.create({
      data: {
        tenantId: input.tenantId,
        businessId: input.businessId,
        keywordOrPattern: input.keywordOrPattern,
        severity: input.severity,
        escalationAction: input.escalationAction,
      },
    });
  }

  async listActiveByBusiness(
    db: Db,
    tenantId: string,
    businessId: string,
  ): Promise<EmergencyRule[]> {
    return db.emergencyRule.findMany({ where: { tenantId, businessId, isActive: true } });
  }
}
