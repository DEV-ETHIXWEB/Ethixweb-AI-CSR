import type { Prisma, PrismaClient } from "@ethixweb/database";
import type { EmergencyRule } from "../emergency-rule.entity";

export type Db = PrismaClient | Prisma.TransactionClient;

export interface CreateEmergencyRuleInput {
  tenantId: string;
  businessId: string;
  keywordOrPattern: string;
  severity: string;
  escalationAction: string;
}

export interface EmergencyRuleRepository {
  create(db: Db, input: CreateEmergencyRuleInput): Promise<EmergencyRule>;
  /** Active rules only, for the businessId — the matching engine's whole input set. */
  listActiveByBusiness(db: Db, tenantId: string, businessId: string): Promise<EmergencyRule[]>;
}

export const EMERGENCY_RULE_REPOSITORY = Symbol("EMERGENCY_RULE_REPOSITORY");
