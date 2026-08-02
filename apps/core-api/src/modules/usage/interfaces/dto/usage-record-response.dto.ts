import { ApiProperty } from "@nestjs/swagger";
import type { UsageRecord } from "../../domain/usage-record.entity";

export class UsageRecordResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() tenantId: string;
  @ApiProperty() businessId: string;
  @ApiProperty({ nullable: true }) callId: string | null;
  @ApiProperty({ nullable: true }) leadId: string | null;
  @ApiProperty() usageType: string;
  @ApiProperty() source: string;
  @ApiProperty() quantity: number;
  @ApiProperty() unit: string;
  @ApiProperty({ nullable: true }) estimatedProviderCostUsd: string | null;
  @ApiProperty() dedupKey: string;
  @ApiProperty() metadata: Record<string, unknown>;
  @ApiProperty() occurredAt: string;
  @ApiProperty() createdAt: string;

  private constructor(record: UsageRecord) {
    this.id = record.id;
    this.tenantId = record.tenantId;
    this.businessId = record.businessId;
    this.callId = record.callId;
    this.leadId = record.leadId;
    this.usageType = record.usageType;
    this.source = record.source;
    this.quantity = record.quantity;
    this.unit = record.unit;
    this.estimatedProviderCostUsd = record.estimatedProviderCostUsd;
    this.dedupKey = record.dedupKey;
    this.metadata = record.metadata;
    this.occurredAt = record.occurredAt;
    this.createdAt = record.createdAt;
  }

  static fromDomain(record: UsageRecord): UsageRecordResponseDto {
    return new UsageRecordResponseDto(record);
  }
}
