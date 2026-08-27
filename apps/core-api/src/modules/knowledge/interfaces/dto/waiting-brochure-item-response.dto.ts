import { ApiProperty } from "@nestjs/swagger";
import type { KnowledgeItem } from "../../domain/knowledge-item.entity";

/** The minimal shape voice-orchestrator's HttpCapacityConfigProvider consumes for brochure segments — `{id, text}`, text = the item's content. */
export class WaitingBrochureItemResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() text: string;

  private constructor(item: KnowledgeItem) {
    this.id = item.id;
    this.text = item.content;
  }

  static fromDomain(item: KnowledgeItem): WaitingBrochureItemResponseDto {
    return new WaitingBrochureItemResponseDto(item);
  }
}
