import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsDateString, IsIn, IsInt, IsOptional, IsUUID, Max, Min } from "class-validator";
import { CALL_STATUSES, type CallStatus } from "../../domain/call.entity";

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

/** Mirrors ListLeadsQueryDto's exact pagination/filter pattern (leads/interfaces/dto/list-leads-query.dto.ts) — the dispatcher-facing call inbox, added for the dashboard's Live Calls page. `status` is CALL_STATUSES (call.entity.ts), not invented — only in_progress/completed/abandoned exist. */
export class ListCallsQueryDto {
  @ApiProperty()
  @IsUUID()
  businessId!: string;

  @ApiPropertyOptional({ enum: CALL_STATUSES })
  @IsOptional()
  @IsIn(CALL_STATUSES)
  status?: CallStatus;

  @ApiPropertyOptional({ description: "ISO 8601 — calls started at or after this instant" })
  @IsOptional()
  @IsDateString()
  createdAfter?: string;

  @ApiPropertyOptional({ description: "ISO 8601 — calls started at or before this instant" })
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
