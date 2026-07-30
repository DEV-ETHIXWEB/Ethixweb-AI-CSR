import { ApiProperty } from "@nestjs/swagger";
import type { Integration } from "../../domain/integration.entity";

/** Never includes credentials, encrypted or decrypted — Integration itself doesn't carry them (see integration.entity.ts). */
export class IntegrationResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() tenantId: string;
  @ApiProperty() businessId: string;
  @ApiProperty() crmType: string;
  @ApiProperty() authType: string;
  @ApiProperty() status: string;
  @ApiProperty({ nullable: true }) lastVerifiedAt: Date | null;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;

  private constructor(integration: Integration) {
    this.id = integration.id;
    this.tenantId = integration.tenantId;
    this.businessId = integration.businessId;
    this.crmType = integration.crmType;
    this.authType = integration.authType;
    this.status = integration.status;
    this.lastVerifiedAt = integration.lastVerifiedAt;
    this.createdAt = integration.createdAt;
    this.updatedAt = integration.updatedAt;
  }

  static fromDomain(integration: Integration): IntegrationResponseDto {
    return new IntegrationResponseDto(integration);
  }
}
