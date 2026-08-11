import { ApiProperty } from "@nestjs/swagger";
import type { ListKnowledgeResult } from "../../domain/ports/knowledge-repository.port";
import { KnowledgeItemResponseDto } from "./knowledge-item-response.dto";

export class PaginatedKnowledgeResponseDto {
  @ApiProperty({ type: [KnowledgeItemResponseDto] }) items: KnowledgeItemResponseDto[];
  @ApiProperty() total: number;

  private constructor(result: ListKnowledgeResult) {
    this.items = result.items.map((item) => KnowledgeItemResponseDto.fromDomain(item));
    this.total = result.total;
  }

  static fromDomain(result: ListKnowledgeResult): PaginatedKnowledgeResponseDto {
    return new PaginatedKnowledgeResponseDto(result);
  }
}
