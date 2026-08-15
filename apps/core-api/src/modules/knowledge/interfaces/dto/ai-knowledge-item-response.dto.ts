import { ApiProperty } from "@nestjs/swagger";
import type { KnowledgeItem } from "../../domain/knowledge-item.entity";

/** The shape voice-orchestrator's system-prompt assembly consumes — `{id, category, title, content, priority}`, enough to render a labeled knowledge section, unlike the brochure DTO's flatter `{id, text}` (brochure segments are read verbatim; knowledge items are grouped/labeled by category in the prompt). */
export class AiKnowledgeItemResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() category: string;
  @ApiProperty() title: string;
  @ApiProperty() content: string;
  @ApiProperty() priority: number;

  private constructor(item: KnowledgeItem) {
    this.id = item.id;
    this.category = item.category;
    this.title = item.title;
    this.content = item.content;
    this.priority = item.priority;
  }

  static fromDomain(item: KnowledgeItem): AiKnowledgeItemResponseDto {
    return new AiKnowledgeItemResponseDto(item);
  }
}
