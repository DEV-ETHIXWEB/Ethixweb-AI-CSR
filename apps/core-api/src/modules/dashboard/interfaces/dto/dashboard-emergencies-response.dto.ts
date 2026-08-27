import { ApiProperty } from "@nestjs/swagger";
import type {
  DashboardEmergency,
  ListDashboardEmergenciesResult,
} from "../../application/list-dashboard-emergencies.use-case";

export class DashboardEmergencyDto {
  @ApiProperty() id: string;
  @ApiProperty({ nullable: true }) callId: string | null;
  @ApiProperty({ nullable: true }) leadId: string | null;
  @ApiProperty() severity: string;
  @ApiProperty() action: string;
  @ApiProperty({ nullable: true }) matchedPattern: string | null;
  @ApiProperty() createdAt: string;

  constructor(emergency: DashboardEmergency) {
    this.id = emergency.id;
    this.callId = emergency.callId;
    this.leadId = emergency.leadId;
    this.severity = emergency.severity;
    this.action = emergency.action;
    this.matchedPattern = emergency.matchedPattern;
    this.createdAt = emergency.createdAt;
  }
}

/** Always `{items: [], total: 0}` today — see ListDashboardEmergenciesUseCase's own comment on why (no persisted emergency-escalation field on Lead/Call). */
export class DashboardEmergenciesResponseDto {
  @ApiProperty({ type: [DashboardEmergencyDto] }) items: DashboardEmergencyDto[];
  @ApiProperty() total: number;

  private constructor(result: ListDashboardEmergenciesResult) {
    this.items = result.items.map((item) => new DashboardEmergencyDto(item));
    this.total = result.total;
  }

  static fromDomain(result: ListDashboardEmergenciesResult): DashboardEmergenciesResponseDto {
    return new DashboardEmergenciesResponseDto(result);
  }
}
