import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString, IsUUID, Matches, MaxLength } from "class-validator";

const E164_PATTERN = /^\+[1-9]\d{1,14}$/;

export class StartConversationDto {
  @ApiProperty()
  @IsUUID()
  tenantId!: string;

  @ApiProperty()
  @IsUUID()
  businessId!: string;

  @ApiProperty({ description: "The Voice Runtime's call identifier — one conversation per call." })
  @IsUUID()
  callId!: string;

  @ApiProperty({ example: "+15551234567" })
  @Matches(E164_PATTERN, { message: "callerAni must be a valid E.164 phone number" })
  callerAni!: string;

  @ApiPropertyOptional({ example: "America/Chicago" })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;
}
