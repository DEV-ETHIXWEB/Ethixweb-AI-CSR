import { ApiProperty } from "@nestjs/swagger";
import type { Business } from "../../domain/business.entity";

export class BusinessResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() tenantId: string;
  @ApiProperty() name: string;
  @ApiProperty() timezone: string;
  @ApiProperty() crmType: string;
  @ApiProperty() status: string;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;

  private constructor(business: Business) {
    this.id = business.id;
    this.tenantId = business.tenantId;
    this.name = business.name;
    this.timezone = business.timezone;
    this.crmType = business.crmType;
    this.status = business.status;
    this.createdAt = business.createdAt;
    this.updatedAt = business.updatedAt;
  }

  static fromDomain(business: Business): BusinessResponseDto {
    return new BusinessResponseDto(business);
  }
}
