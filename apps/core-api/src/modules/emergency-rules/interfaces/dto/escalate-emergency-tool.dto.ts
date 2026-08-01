import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { ArrayNotEmpty, IsArray, IsOptional, IsString, IsUUID, Length } from "class-validator";

/** docs/04 §3.8 escalateEmergency — tool-broker-facing, API-key auth only (see EmergencyRulesToolController's own comment). */
export class EscalateEmergencyToolDto {
  @ApiProperty()
  @IsUUID()
  businessId!: string;

  @ApiProperty()
  @IsUUID()
  callId!: string;

  @ApiProperty()
  @IsString()
  @Length(1, 4000)
  description!: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  detectedKeywords?: string[];
}
