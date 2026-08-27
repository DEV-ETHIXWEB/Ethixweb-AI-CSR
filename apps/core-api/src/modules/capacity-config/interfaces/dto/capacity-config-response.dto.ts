import { ApiProperty } from "@nestjs/swagger";
import type { CapacityConfigResult } from "../../application/get-capacity-config.use-case";
import type { TenantCapacityConfig } from "../../domain/tenant-capacity-config.entity";

function toResult(source: CapacityConfigResult | TenantCapacityConfig): CapacityConfigResult {
  return {
    id: source.id,
    tenantId: source.tenantId,
    businessId: source.businessId,
    maxTenantConcurrentCalls: source.maxTenantConcurrentCalls,
    maxWaitingCallers: source.maxWaitingCallers,
    waitingTimeoutMs: source.waitingTimeoutMs,
    emergencyHeadroomRatio: source.emergencyHeadroomRatio,
    overflowNumber: source.overflowNumber,
    brochureEnabled: source.brochureEnabled,
    brochureRotationMs: source.brochureRotationMs,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
  };
}

/** Flat, minimal shape — this is exactly what voice-orchestrator's HttpCapacityConfigProvider (internal/capacity-config/:businessId) and the dashboard (dashboard/capacity-config/:businessId) both consume, defaults-if-absent per GetCapacityConfigUseCase's own contract. Accepts either GetCapacityConfigUseCase's defaults-shaped result or UpsertCapacityConfigUseCase's real `TenantCapacityConfig` row — a real row's `id`/`createdAt`/`updatedAt` are never null, a perfectly valid narrowing of the same nullable fields. */
export class CapacityConfigResponseDto {
  @ApiProperty({ nullable: true }) id: string | null;
  @ApiProperty() tenantId: string;
  @ApiProperty() businessId: string;
  @ApiProperty() maxTenantConcurrentCalls: number;
  @ApiProperty() maxWaitingCallers: number;
  @ApiProperty() waitingTimeoutMs: number;
  @ApiProperty() emergencyHeadroomRatio: number;
  @ApiProperty({ nullable: true }) overflowNumber: string | null;
  @ApiProperty() brochureEnabled: boolean;
  @ApiProperty() brochureRotationMs: number;
  @ApiProperty({ nullable: true }) createdAt: Date | null;
  @ApiProperty({ nullable: true }) updatedAt: Date | null;

  private constructor(source: CapacityConfigResult | TenantCapacityConfig) {
    const result = toResult(source);
    this.id = result.id;
    this.tenantId = result.tenantId;
    this.businessId = result.businessId;
    this.maxTenantConcurrentCalls = result.maxTenantConcurrentCalls;
    this.maxWaitingCallers = result.maxWaitingCallers;
    this.waitingTimeoutMs = result.waitingTimeoutMs;
    this.emergencyHeadroomRatio = result.emergencyHeadroomRatio;
    this.overflowNumber = result.overflowNumber;
    this.brochureEnabled = result.brochureEnabled;
    this.brochureRotationMs = result.brochureRotationMs;
    this.createdAt = result.createdAt;
    this.updatedAt = result.updatedAt;
  }

  static fromDomain(
    source: CapacityConfigResult | TenantCapacityConfig,
  ): CapacityConfigResponseDto {
    return new CapacityConfigResponseDto(source);
  }
}
