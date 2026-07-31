import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString, IsUUID, Length, MaxLength } from "class-validator";

// Matches docs/04-ai-tool-architecture.md §3.3's authoritative `createLead`
// tool contract exactly — found to be mismatched during the leads module's
// build-out (this DTO previously used an unrelated ad hoc enum here that
// never matched the documented tool contract this CRM endpoint exists to
// serve).
export const LEAD_PRIORITIES = ["emergency", "urgent", "routine", "estimate"] as const;
export const LEAD_TYPES = ["residential", "commercial"] as const;

export class CreateLeadDto {
  @ApiProperty()
  @IsUUID()
  integrationId!: string;

  @ApiProperty({
    description:
      "The CRM's own customer id (not this platform's), from a prior searchCustomer/createCustomer result",
  })
  @IsString()
  @MaxLength(200)
  crmCustomerId!: string;

  @ApiProperty({
    description: "Qualification summary/transcript reference for the CRM-side record",
  })
  @IsString()
  @Length(1, 4000)
  problemSummary!: string;

  @ApiProperty({ enum: LEAD_PRIORITIES })
  @IsIn(LEAD_PRIORITIES)
  priority!: (typeof LEAD_PRIORITIES)[number];

  @ApiProperty({ enum: LEAD_TYPES })
  @IsIn(LEAD_TYPES)
  leadType!: (typeof LEAD_TYPES)[number];

  @ApiPropertyOptional({
    description:
      "Opt-in — supply a stable key to make retrying this exact request safe (returns the first call's result instead of creating a duplicate lead).",
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  idempotencyKey?: string;
}
