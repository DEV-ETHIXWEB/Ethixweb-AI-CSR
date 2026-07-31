import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsDateString, IsIn, IsInt, IsOptional, IsUUID, Max, Min } from "class-validator";
import type { LeadStatus } from "@ethixweb/database";

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

/** Mirrors lead-lifecycle.ts's ALLOWED_TRANSITIONS key set — the full LeadStatus enum, not invented here. */
const LEAD_STATUSES = [
  "new",
  "notified",
  "claimed",
  "converted_to_job",
  "expired",
  "duplicate",
  "abandoned",
] as const;

/** docs/13-implementation-backlog.md `leads` module §6: "Lead inbox API (list/filter by status/priority, for the dispatcher-facing dashboard)." */
export class ListLeadsQueryDto {
  @ApiProperty()
  @IsUUID()
  businessId!: string;

  @ApiPropertyOptional({ enum: LEAD_STATUSES })
  @IsOptional()
  @IsIn(LEAD_STATUSES)
  status?: LeadStatus;

  @ApiPropertyOptional()
  @IsOptional()
  priority?: string;

  @ApiPropertyOptional({ description: "ISO 8601 — leads created at or after this instant" })
  @IsOptional()
  @IsDateString()
  createdAfter?: string;

  @ApiPropertyOptional({ description: "ISO 8601 — leads created at or before this instant" })
  @IsOptional()
  @IsDateString()
  createdBefore?: string;

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
