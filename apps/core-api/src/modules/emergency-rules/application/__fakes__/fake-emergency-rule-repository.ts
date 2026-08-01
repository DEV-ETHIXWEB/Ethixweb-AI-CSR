import { randomUUID } from "node:crypto";
import type { EmergencyRule } from "../../domain/emergency-rule.entity";
import type {
  CreateEmergencyRuleInput,
  Db,
  EmergencyRuleRepository,
} from "../../domain/ports/emergency-rule-repository.port";

export class FakeEmergencyRuleRepository implements EmergencyRuleRepository {
  private readonly rules: EmergencyRule[] = [];

  async create(_db: Db, input: CreateEmergencyRuleInput): Promise<EmergencyRule> {
    const rule: EmergencyRule = {
      id: randomUUID(),
      tenantId: input.tenantId,
      businessId: input.businessId,
      keywordOrPattern: input.keywordOrPattern,
      severity: input.severity,
      escalationAction: input.escalationAction,
      isActive: true,
    };
    this.rules.push(rule);
    return rule;
  }

  async listActiveByBusiness(
    _db: Db,
    tenantId: string,
    businessId: string,
  ): Promise<EmergencyRule[]> {
    return this.rules.filter(
      (rule) => rule.tenantId === tenantId && rule.businessId === businessId && rule.isActive,
    );
  }

  /** Test helper. */
  seed(rule: EmergencyRule): void {
    this.rules.push(rule);
  }
}
