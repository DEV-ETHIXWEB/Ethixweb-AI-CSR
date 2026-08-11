import { ApiProperty } from "@nestjs/swagger";
import { UsageTypeTotalDto } from "../../../usage/interfaces/dto/usage-summary-response.dto";
import type { DashboardOverview } from "../../application/get-dashboard-overview.use-case";

export class DashboardOverviewResponseDto {
  @ApiProperty() tenantId: string;
  @ApiProperty() businessId: string;
  @ApiProperty({
    description:
      "Postgres-row-derived proxy count (Call rows with status=in_progress), NOT voice-orchestrator's live Redis capacity counter — can lag the true live count.",
  })
  activeCallsCount: number;
  @ApiProperty({ description: "Leads created since start of today, UTC." })
  leadsCapturedToday: number;
  @ApiProperty({ description: "Calls started since start of today, UTC." })
  callsToday: number;
  @ApiProperty({
    description:
      "activeCallsCount / maxTenantConcurrentCalls, 0-1. Same Postgres-proxy caveat as activeCallsCount.",
  })
  capacityUtilization: number;
  @ApiProperty({ type: [UsageTypeTotalDto] }) usageToday: UsageTypeTotalDto[];
  @ApiProperty({ description: 'CRM integration status, or "NOT_CONFIGURED" if none exists.' })
  integrationStatus: string;

  private constructor(overview: DashboardOverview) {
    this.tenantId = overview.tenantId;
    this.businessId = overview.businessId;
    this.activeCallsCount = overview.activeCallsCount;
    this.leadsCapturedToday = overview.leadsCapturedToday;
    this.callsToday = overview.callsToday;
    this.capacityUtilization = overview.capacityUtilization;
    this.usageToday = overview.usageToday.map(
      (t) =>
        new UsageTypeTotalDto(
          t.usageType,
          t.unit,
          t.totalQuantity,
          t.recordCount,
          t.totalEstimatedProviderCostUsd,
        ),
    );
    this.integrationStatus = overview.integrationStatus;
  }

  static fromDomain(overview: DashboardOverview): DashboardOverviewResponseDto {
    return new DashboardOverviewResponseDto(overview);
  }
}
