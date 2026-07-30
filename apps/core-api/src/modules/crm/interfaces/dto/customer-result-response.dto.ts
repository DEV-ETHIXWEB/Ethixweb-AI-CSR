import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import type { CustomerResult } from "../../domain/ports/crm-adapter.port";

/** Deliberately omits `raw` (the vendor's unredacted raw response) — never surfaced over the API. */
export class CustomerResultResponseDto {
  @ApiProperty() crmCustomerId: string;
  @ApiProperty() name: string;
  @ApiProperty() phoneE164: string;
  @ApiPropertyOptional() email?: string | undefined;

  private constructor(result: CustomerResult) {
    this.crmCustomerId = result.crmCustomerId;
    this.name = result.name;
    this.phoneE164 = result.phoneE164;
    this.email = result.email;
  }

  static fromDomain(result: CustomerResult): CustomerResultResponseDto {
    return new CustomerResultResponseDto(result);
  }
}
