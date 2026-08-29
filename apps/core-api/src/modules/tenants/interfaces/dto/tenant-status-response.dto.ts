import { ApiProperty } from "@nestjs/swagger";
import type { TenantStatus } from "../../domain/tenant.entity";

export class TenantStatusResponseDto {
  @ApiProperty() status: TenantStatus;

  private constructor(status: TenantStatus) {
    this.status = status;
  }

  static fromDomain(status: TenantStatus): TenantStatusResponseDto {
    return new TenantStatusResponseDto(status);
  }
}
