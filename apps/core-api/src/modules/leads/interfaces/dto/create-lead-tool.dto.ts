import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsObject, IsOptional, IsUUID, Length } from "class-validator";
import { LEAD_PRIORITIES, LEAD_TYPES } from "../../domain/lead.entity";

/**
 * docs/04-ai-tool-architecture.md §3.3 `createLead` — the tool broker's
 * execution surface, gated by API-key auth only (see LeadsToolController's
 * own comment). `tenantId` comes from the authenticated principal, never a
 * body field, same rule as every other controller in this codebase.
 */
export class CreateLeadToolDto {
  @ApiProperty()
  @IsUUID()
  businessId!: string;

  @ApiProperty()
  @IsUUID()
  customerId!: string;

  @ApiProperty({
    description: "The call this lead is being created from — enforces one lead per call.",
  })
  @IsUUID()
  callId!: string;

  @ApiProperty()
  @Length(1, 4000)
  problemSummary!: string;

  @ApiProperty({ enum: LEAD_PRIORITIES })
  @IsIn(LEAD_PRIORITIES)
  priority!: (typeof LEAD_PRIORITIES)[number];

  @ApiProperty({ enum: LEAD_TYPES })
  @IsIn(LEAD_TYPES)
  leadType!: (typeof LEAD_TYPES)[number];

  @ApiPropertyOptional({ type: "object", additionalProperties: true })
  @IsOptional()
  @IsObject()
  qualificationData?: Record<string, unknown>;
}
