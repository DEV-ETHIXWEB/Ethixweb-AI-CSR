import { ApiProperty } from "@nestjs/swagger";
import { IsString, Length, MaxLength } from "class-validator";

// No real IANA timezone identifier or CRM type slug comes anywhere close to
// these — generous headroom over any legitimate value while still bounding
// unvalidated free-text input before it reaches the database.
export const MAX_TIMEZONE_LENGTH = 100;
export const MAX_CRM_TYPE_LENGTH = 100;

export class CreateBusinessDto {
  @ApiProperty({ example: "All Phase Plumbing — Main Office" })
  @IsString()
  @Length(1, 200)
  name!: string;

  @ApiProperty({ example: "America/Chicago", description: "IANA timezone identifier" })
  @IsString()
  @MaxLength(MAX_TIMEZONE_LENGTH)
  timezone!: string;

  @ApiProperty({ example: "housecall_pro" })
  @IsString()
  @MaxLength(MAX_CRM_TYPE_LENGTH)
  crmType!: string;
}
