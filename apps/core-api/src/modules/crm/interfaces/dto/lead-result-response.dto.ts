import { ApiProperty } from "@nestjs/swagger";
import type { LeadResult } from "../../domain/ports/crm-adapter.port";

/** Deliberately omits `raw` — never surfaced over the API. */
export class LeadResultResponseDto {
  @ApiProperty() crmLeadId: string;
  @ApiProperty() status: string;

  private constructor(result: LeadResult) {
    this.crmLeadId = result.crmLeadId;
    this.status = result.status;
  }

  static fromDomain(result: LeadResult): LeadResultResponseDto {
    return new LeadResultResponseDto(result);
  }
}
