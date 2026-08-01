import { ApiProperty } from "@nestjs/swagger";
import type { EscalateEmergencyResult } from "../../application/escalate-emergency.use-case";

export class EscalateEmergencyResponseDto {
  @ApiProperty() isEmergency: boolean;
  @ApiProperty() severity: string;
  @ApiProperty() action: string;
  @ApiProperty({ nullable: true }) matchedPattern: string | null;

  private constructor(result: EscalateEmergencyResult) {
    this.isEmergency = result.isEmergency;
    this.severity = result.severity;
    this.action = result.action;
    this.matchedPattern = result.matchedPattern;
  }

  static fromDomain(result: EscalateEmergencyResult): EscalateEmergencyResponseDto {
    return new EscalateEmergencyResponseDto(result);
  }
}
