import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsOptional, IsUUID, Length } from "class-validator";
import { LEAD_PRIORITIES, LEAD_TYPES } from "../../domain/lead.entity";

/** docs/04-ai-tool-architecture.md §3.4 `updateLead` — see CreateLeadToolDto's own comment on this controller's auth model. */
export class UpdateLeadToolDto {
  @ApiProperty({
    description: "Must match the call_id that created this lead — enforced by UpdateLeadUseCase.",
  })
  @IsUUID()
  callId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Length(1, 4000)
  problemSummary?: string;

  @ApiPropertyOptional({ enum: LEAD_PRIORITIES })
  @IsOptional()
  @IsIn(LEAD_PRIORITIES)
  priority?: (typeof LEAD_PRIORITIES)[number];

  @ApiPropertyOptional({ enum: LEAD_TYPES })
  @IsOptional()
  @IsIn(LEAD_TYPES)
  leadType?: (typeof LEAD_TYPES)[number];
}
