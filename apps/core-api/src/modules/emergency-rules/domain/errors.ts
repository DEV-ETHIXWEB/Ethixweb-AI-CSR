import { NotFoundDomainError } from "../../../shared/domain/domain-error";

export class EmergencyRuleNotFoundError extends NotFoundDomainError {
  constructor(public readonly ruleId: string) {
    super(`Emergency rule not found: ${ruleId}`);
    this.name = "EmergencyRuleNotFoundError";
  }
}
