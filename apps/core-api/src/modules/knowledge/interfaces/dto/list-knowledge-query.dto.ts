import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min } from "class-validator";
import {
  KNOWLEDGE_ITEM_STATUSES,
  type KnowledgeItemStatus,
} from "../../domain/knowledge-item.entity";

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

/** Mirrors ListLeadsQueryDto's exact shape/style. */
export class ListKnowledgeQueryDto {
  @ApiProperty()
  @IsUUID()
  businessId!: string;

  @ApiPropertyOptional({ enum: KNOWLEDGE_ITEM_STATUSES })
  @IsOptional()
  @IsIn(KNOWLEDGE_ITEM_STATUSES)
  status?: KnowledgeItemStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  aiKnowledge?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  waitingBrochure?: boolean;

  @ApiPropertyOptional({ default: DEFAULT_PAGE })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = DEFAULT_PAGE;

  @ApiPropertyOptional({ default: DEFAULT_PAGE_SIZE })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  pageSize: number = DEFAULT_PAGE_SIZE;
}
