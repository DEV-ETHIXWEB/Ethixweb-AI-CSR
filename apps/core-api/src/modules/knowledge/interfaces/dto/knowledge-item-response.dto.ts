import { ApiProperty } from "@nestjs/swagger";
import type { KnowledgeItem, KnowledgeItemStatus } from "../../domain/knowledge-item.entity";

export class KnowledgeItemResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() tenantId: string;
  @ApiProperty() businessId: string;
  @ApiProperty() category: string;
  @ApiProperty() title: string;
  @ApiProperty() content: string;
  @ApiProperty() status: KnowledgeItemStatus;
  @ApiProperty() aiKnowledge: boolean;
  @ApiProperty() waitingBrochure: boolean;
  @ApiProperty() priority: number;
  @ApiProperty({ nullable: true }) createdByUserId: string | null;
  @ApiProperty({ nullable: true }) updatedByUserId: string | null;
  @ApiProperty({ nullable: true }) approvedByUserId: string | null;
  @ApiProperty({ nullable: true }) approvedAt: Date | null;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;

  private constructor(item: KnowledgeItem) {
    this.id = item.id;
    this.tenantId = item.tenantId;
    this.businessId = item.businessId;
    this.category = item.category;
    this.title = item.title;
    this.content = item.content;
    this.status = item.status;
    this.aiKnowledge = item.aiKnowledge;
    this.waitingBrochure = item.waitingBrochure;
    this.priority = item.priority;
    this.createdByUserId = item.createdByUserId;
    this.updatedByUserId = item.updatedByUserId;
    this.approvedByUserId = item.approvedByUserId;
    this.approvedAt = item.approvedAt;
    this.createdAt = item.createdAt;
    this.updatedAt = item.updatedAt;
  }

  static fromDomain(item: KnowledgeItem): KnowledgeItemResponseDto {
    return new KnowledgeItemResponseDto(item);
  }
}
