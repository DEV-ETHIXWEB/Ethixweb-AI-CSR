import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsDateString,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Min,
} from "class-validator";
import { USAGE_TYPES, USAGE_UNITS } from "../../domain/usage-record.entity";

/** docs/26-usage-metering.md §2's ingestion contract — internal-service-facing, API-key auth only (see UsageToolController's own comment). */
export class RecordUsageDto {
  @ApiProperty()
  @IsUUID()
  businessId!: string;

  @ApiPropertyOptional({
    description: "The Voice Runtime's call identifier, if this usage event correlates to one call.",
  })
  @IsOptional()
  @IsUUID()
  callId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  leadId?: string;

  @ApiProperty({ enum: USAGE_TYPES })
  @IsIn(USAGE_TYPES)
  usageType!: (typeof USAGE_TYPES)[number];

  @ApiProperty({
    description:
      "Free-form provider/component identifier, e.g. 'twilio', 'deepgram', 'openai:gpt-4o'.",
  })
  @IsString()
  @Length(1, 100)
  source!: string;

  @ApiProperty({ description: "Non-negative integer — exact measured units, never a float." })
  @IsInt()
  @Min(0)
  quantity!: number;

  @ApiProperty({ enum: USAGE_UNITS })
  @IsIn(USAGE_UNITS)
  unit!: (typeof USAGE_UNITS)[number];

  @ApiPropertyOptional({
    description:
      "This platform's OWN vendor cost estimate for this event, as a decimal string — informational only, never what a tenant is billed.",
    example: "0.001234",
  })
  @IsOptional()
  @IsString()
  @Length(1, 32)
  estimatedProviderCostUsd?: string;

  @ApiProperty({
    description:
      "Client-generated, unique per real usage event — a replay with the same key returns the existing record rather than creating a duplicate.",
  })
  @IsString()
  @Length(1, 200)
  dedupKey!: string;

  @ApiPropertyOptional({
    description:
      "Provider/correlation metadata — observability only, never parsed for billing logic.",
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @ApiProperty({
    description:
      "ISO-8601 timestamp of when the usage actually occurred (not when it was recorded).",
  })
  @IsDateString()
  occurredAt!: string;
}
