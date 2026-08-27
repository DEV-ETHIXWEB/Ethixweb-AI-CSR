import { ApiProperty } from "@nestjs/swagger";
import type { EscalateEmergencyResult } from "../../application/escalate-emergency.use-case";

export class EscalateEmergencyResponseDto {
  @ApiProperty() isEmergency: boolean;
  @ApiProperty() severity: string;
  @ApiProperty() action: string;
  @ApiProperty({ nullable: true }) matchedPattern: string | null;
  @ApiProperty({
    type: [String],
    description: "Phone numbers to transfer to, in ring order. Only non-empty when action is forward_call.",
  })
  transferTargets: string[];

  private constructor(result: EscalateEmergencyResult) {
    this.isEmergency = result.isEmergency;
    this.severity = result.severity;
    this.action = result.action;
    this.matchedPattern = result.matchedPattern;
    this.transferTargets = result.transferTargets;
  }

  static fromDomain(result: EscalateEmergencyResult): EscalateEmergencyResponseDto {
    return new EscalateEmergencyResponseDto(result);
  }
}
