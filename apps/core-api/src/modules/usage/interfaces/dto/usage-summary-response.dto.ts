import { ApiProperty } from "@nestjs/swagger";
import type { UsageSummary } from "../../application/get-usage-summary.use-case";

export class UsageTypeTotalDto {
  @ApiProperty() usageType: string;
  @ApiProperty() unit: string;
  @ApiProperty() totalQuantity: number;
  @ApiProperty() recordCount: number;
  @ApiProperty({ nullable: true }) totalEstimatedProviderCostUsd: string | null;

  constructor(
    usageType: string,
    unit: string,
    totalQuantity: number,
    recordCount: number,
    totalEstimatedProviderCostUsd: string | null,
  ) {
    this.usageType = usageType;
    this.unit = unit;
    this.totalQuantity = totalQuantity;
    this.recordCount = recordCount;
    this.totalEstimatedProviderCostUsd = totalEstimatedProviderCostUsd;
  }
}

export class UsageSummaryResponseDto {
  @ApiProperty() tenantId: string;
  @ApiProperty({ nullable: true }) businessId: string | null;
  @ApiProperty() from: string;
  @ApiProperty() to: string;
  @ApiProperty({ type: [UsageTypeTotalDto] }) totals: UsageTypeTotalDto[];

  private constructor(summary: UsageSummary) {
    this.tenantId = summary.tenantId;
    this.businessId = summary.businessId;
    this.from = summary.from;
    this.to = summary.to;
    this.totals = summary.totals.map(
      (t) =>
        new UsageTypeTotalDto(
          t.usageType,
          t.unit,
          t.totalQuantity,
          t.recordCount,
          t.totalEstimatedProviderCostUsd,
        ),
    );
  }

  static fromDomain(summary: UsageSummary): UsageSummaryResponseDto {
    return new UsageSummaryResponseDto(summary);
  }
}
