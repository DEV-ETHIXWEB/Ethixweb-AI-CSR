import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsBoolean, IsInt, IsOptional, IsString, IsUUID, Length, Min } from "class-validator";

const DEFAULT_AI_KNOWLEDGE = false;
const DEFAULT_WAITING_BROCHURE = false;
const DEFAULT_PRIORITY = 0;

/** No `status` field — creation always starts in draft (see CreateKnowledgeItemUseCase's own comment); there is no way for a caller to request otherwise through this DTO. */
export class CreateKnowledgeItemDto {
  @ApiProperty()
  @IsUUID()
  businessId!: string;

  @ApiProperty()
  @IsString()
  @Length(1, 100)
  category!: string;

  @ApiProperty()
  @IsString()
  @Length(1, 200)
  title!: string;

  @ApiProperty()
  @IsString()
  @Length(1, 8000)
  content!: string;

  @ApiPropertyOptional({ default: DEFAULT_AI_KNOWLEDGE })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  aiKnowledge: boolean = DEFAULT_AI_KNOWLEDGE;

  @ApiPropertyOptional({ default: DEFAULT_WAITING_BROCHURE })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  waitingBrochure: boolean = DEFAULT_WAITING_BROCHURE;

  @ApiPropertyOptional({ default: DEFAULT_PRIORITY })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  priority: number = DEFAULT_PRIORITY;
}
