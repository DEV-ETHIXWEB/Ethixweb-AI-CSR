import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from "class-validator";

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

export class ListCustomersQueryDto {
  // Genuinely required (no @IsOptional here) — found during review:
  // this was previously documented as @ApiPropertyOptional, which would
  // have told OpenAPI consumers they could omit it, while class-validator
  // would reject that same omitted request. The Swagger annotation must
  // match the actual validation behavior, not just look permissive.
  @ApiProperty()
  @IsUUID()
  businessId!: string;

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

  @ApiPropertyOptional({ description: "Case-insensitive partial match against name or phone" })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;
}
