import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString, IsUUID, Length, MaxLength } from "class-validator";

export const LEAD_PRIORITIES = ["low", "normal", "high", "emergency"] as const;
export const LEAD_TYPES = [
  "service_call",
  "quote_request",
  "emergency",
  "general_inquiry",
] as const;

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
