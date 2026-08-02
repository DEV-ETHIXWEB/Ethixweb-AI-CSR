import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsDateString, IsIn, IsOptional, IsString, IsUUID, Length } from "class-validator";
import { CALL_DIRECTIONS } from "../../domain/call.entity";

/**
 * docs/13-implementation-backlog.md `calls` module item 2: "call started
 * webhooks from the voice orchestrator" — this IS that webhook, gated by
 * API-key auth only (see CallsToolController's own comment). Must be
 * called before `POST /internal/leads` ever references the resulting
 * callId, per Lead.callId's real database foreign key.
 */
export class StartCallDto {
  @ApiProperty()
  @IsUUID()
  businessId!: string;

  @ApiPropertyOptional({
    description: "Only known if searchCustomer/createCustomer already ran for this call.",
  })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiProperty({ enum: CALL_DIRECTIONS })
  @IsIn(CALL_DIRECTIONS)
  direction!: (typeof CALL_DIRECTIONS)[number];

  @ApiProperty({ example: "+15551234567" })
  @IsString({ message: "fromNumber must be a string" })
  @Length(1, 32)
  fromNumber!: string;

  @ApiProperty({ example: "+15559876543" })
  @IsString({ message: "toNumber must be a string" })
  @Length(1, 32)
  toNumber!: string;

  @ApiProperty({
    description:
      "The telephony/runtime provider's own call identifier (e.g. Twilio CallSid) — the idempotency key for call creation. A duplicated call.started delivery with the same value returns the existing call.",
  })
  @IsString()
  @Length(1, 100)
  telephonyCallSid!: string;

  @ApiProperty({ description: "ISO-8601 timestamp of when the call actually connected." })
  @IsDateString()
  startedAt!: string;
}
