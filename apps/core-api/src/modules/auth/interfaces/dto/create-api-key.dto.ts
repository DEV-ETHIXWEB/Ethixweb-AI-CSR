import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsISO8601, IsOptional } from "class-validator";

export const API_KEY_SCOPES = ["full", "read_only"] as const;

export class CreateApiKeyDto {
  @ApiProperty({ enum: API_KEY_SCOPES })
  @IsIn(API_KEY_SCOPES)
  scopes!: (typeof API_KEY_SCOPES)[number];

  @ApiPropertyOptional({ description: "ISO 8601 timestamp; omit for a non-expiring key." })
  @IsOptional()
  @IsISO8601()
  expiresAt?: string;
}
