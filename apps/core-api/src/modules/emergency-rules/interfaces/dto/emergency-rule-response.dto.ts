import { ApiProperty } from "@nestjs/swagger";
import type { EmergencyRule } from "../../domain/emergency-rule.entity";

export class EmergencyRuleResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() businessId: string;
  @ApiProperty() keywordOrPattern: string;
  @ApiProperty() severity: string;
  @ApiProperty() escalationAction: string;
  @ApiProperty() isActive: boolean;

  private constructor(rule: EmergencyRule) {
    this.id = rule.id;
    this.businessId = rule.businessId;
    this.keywordOrPattern = rule.keywordOrPattern;
    this.severity = rule.severity;
    this.escalationAction = rule.escalationAction;
    this.isActive = rule.isActive;
  }

  static fromDomain(rule: EmergencyRule): EmergencyRuleResponseDto {
    return new EmergencyRuleResponseDto(rule);
  }
}
