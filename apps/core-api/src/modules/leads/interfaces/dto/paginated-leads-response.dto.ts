import { ApiProperty } from "@nestjs/swagger";
import type { ListLeadsResult } from "../../domain/ports/lead-repository.port";
import { LeadResponseDto } from "./lead-response.dto";

export class PaginatedLeadsResponseDto {
  @ApiProperty({ type: [LeadResponseDto] }) items: LeadResponseDto[];
  @ApiProperty() total: number;

  private constructor(result: ListLeadsResult) {
    this.items = result.items.map((lead) => LeadResponseDto.fromDomain(lead));
    this.total = result.total;
  }

  static fromDomain(result: ListLeadsResult): PaginatedLeadsResponseDto {
    return new PaginatedLeadsResponseDto(result);
  }
}
