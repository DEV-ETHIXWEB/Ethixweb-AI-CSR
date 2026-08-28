import { ApiProperty } from "@nestjs/swagger";
import { IsString, Length, Matches } from "class-validator";
import { E164_PATTERN } from "../../../../shared/domain/e164";

/**
 * Twilio's real inbound-SMS webhook natively POSTs
 * `application/x-www-form-urlencoded` with its own field names (`From`,
 * `To`, `Body`, `MessageSid`, plus others this handler doesn't need) — this
 * DTO now matches that shape directly (Nest's FastifyAdapter's own
 * built-in urlencoded parser — see main.ts's own comment) rather than a
 * hand-shaped JSON approximation. This class is deliberately validated
 * OUTSIDE the global ValidationPipe (main.ts sets `forbidNonWhitelisted:
 * true`, which REJECTS a request containing any undeclared property, and
 * Twilio's real webhook always sends more fields than this DTO declares —
 * `AccountSid`, `NumMedia`, ... — a real, previously-shipped bug, not a
 * hypothetical one) — see SmsWebhooksController's own comment for exactly
 * how (its `receive()` handler manually runs `plainToInstance` +
 * `validate(dto, { whitelist: true })`, deliberately omitting
 * `forbidNonWhitelisted`, so undeclared fields are safely stripped rather
 * than rejecting the request). See that same comment for the small
 * mapping step from these Twilio field names to
 * HandleSmsClaimReplyUseCase's existing (fromPhone, body) signature, kept
 * untouched here to avoid cascading this change through that use case.
 */
export class SmsClaimReplyDto {
  @ApiProperty({
    example: "+15551234567",
    description: "The technician's phone number (Twilio's `From`).",
  })
  @Matches(E164_PATTERN, { message: "From must be a valid E.164 phone number" })
  From!: string;

  @ApiProperty({
    example: "+15559999999",
    description: "The platform's Twilio number (Twilio's `To`).",
  })
  @Matches(E164_PATTERN, { message: "To must be a valid E.164 phone number" })
  To!: string;

  @ApiProperty({ example: "CLAIM" })
  @IsString()
  @Length(1, 1600)
  Body!: string;

  @ApiProperty({ example: "SMxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" })
  @IsString()
  MessageSid!: string;
}
