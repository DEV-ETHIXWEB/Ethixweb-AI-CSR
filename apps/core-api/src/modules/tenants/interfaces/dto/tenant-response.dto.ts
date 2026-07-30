import { ApiProperty } from "@nestjs/swagger";
import type { Tenant } from "../../domain/tenant.entity";

export class TenantResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() planTier: string;
  @ApiProperty() status: string;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;

  private constructor(tenant: Tenant) {
    this.id = tenant.id;
    this.name = tenant.name;
    this.planTier = tenant.planTier;
    this.status = tenant.status;
    this.createdAt = tenant.createdAt;
    this.updatedAt = tenant.updatedAt;
  }

  static fromDomain(tenant: Tenant): TenantResponseDto {
    return new TenantResponseDto(tenant);
  }
}
