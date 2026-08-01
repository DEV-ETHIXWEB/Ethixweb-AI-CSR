import { ApiProperty } from "@nestjs/swagger";
import { IsString, Length, Matches } from "class-validator";
import { E164_PATTERN } from "../../../../shared/domain/e164";

/**
 * Twilio's real inbound-SMS webhook natively POSTs
 * `application/x-www-form-urlencoded` with its own field names (`From`,
 * `To`, `Body`, `MessageSid`, plus others this handler doesn't need) — this
 * DTO now matches that shape directly (form body parsing is wired via
 * `@fastify/formbody`, see main.ts) rather than a hand-shaped JSON
 * approximation. `@Body()` + the global ValidationPipe's `transform: true`
 * (main.ts) still validate/coerce it exactly like any other DTO;
 * `forbidNonWhitelisted` is what makes the extra fields Twilio sends
 * (`MessageSid`, `AccountSid`, `NumMedia`, ...) get silently stripped
 * instead of rejecting the request outright — see SmsWebhooksController's
 * own comment for the small mapping step from these Twilio field names to
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
