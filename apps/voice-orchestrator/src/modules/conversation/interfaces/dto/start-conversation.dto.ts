import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsBoolean, IsOptional, IsString, IsUUID, Matches, MaxLength } from "class-validator";

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

  @ApiPropertyOptional({
    example: "+15559876543",
    description:
      "The business's own number the call landed on, if known — passed through to the production-blocker fix's Call row (core-api's calls module) for completeness only; never read by anything in this service's own conversation logic. Falls back to a placeholder when omitted rather than making this a breaking contract change for existing callers.",
  })
  @IsOptional()
  @Matches(E164_PATTERN, { message: "toNumber must be a valid E.164 phone number" })
  toNumber?: string;

  @ApiPropertyOptional({ example: "America/Chicago" })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

  @ApiPropertyOptional({
    description:
      "docs/36: an OPTIONAL, best-effort signal that the Voice Runtime believes this call is emergency-priority BEFORE any conversation exists (e.g. a caller ID previously flagged, an IVR keypress route, or a runtime-side heuristic). This service has no way to detect an emergency itself before a turn happens — emergency detection is the escalateEmergency tool's job, mid-conversation. When true, this admission attempt may use capacity reserved as headroom for exactly this purpose (see CapacityConfig.emergencyHeadroomRatio) rather than being capped like a normal call. Omit or false for every ordinary call — this field does not and cannot guarantee a specific call IS an emergency, only that the runtime is asking for the headroom band.",
  })
  @IsOptional()
  @IsBoolean()
  isEmergencyPriority?: boolean;
}
