import { ApiProperty } from "@nestjs/swagger";
import type { ListCallsResult } from "../../domain/ports/call-repository.port";
import { CallResponseDto } from "./call-response.dto";

/** Mirrors PaginatedLeadsResponseDto's exact {items, total} shape. */
export class PaginatedCallsResponseDto {
  @ApiProperty({ type: [CallResponseDto] }) items: CallResponseDto[];
  @ApiProperty() total: number;

  private constructor(result: ListCallsResult) {
    this.items = result.items.map((call) => CallResponseDto.fromDomain(call));
    this.total = result.total;
  }

  static fromDomain(result: ListCallsResult): PaginatedCallsResponseDto {
    return new PaginatedCallsResponseDto(result);
  }
}
