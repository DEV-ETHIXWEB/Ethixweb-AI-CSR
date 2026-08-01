import { ApiProperty } from "@nestjs/swagger";
import { IsString, Length, Matches } from "class-validator";
import { E164_PATTERN } from "../../../../shared/domain/e164";

/**
 * Twilio's real inbound-SMS webhook natively POSTs
 * `application/x-www-form-urlencoded` (`From`/`To`/`Body` fields) — this
 * endpoint expects the equivalent JSON shape below. Wiring the raw
 * Twilio form-encoded payload to this shape needs a form-body parser
 * (e.g. `@fastify/formbody`) registered ahead of this route, which this
 * build does not add speculatively (no live Twilio number in this
 * environment to verify the wiring against, same "don't guess" discipline
 * as everywhere else in this build) — a real, named, small integration
 * step for whoever connects a live Twilio number, not a hidden gap.
 */
export class SmsClaimReplyDto {
  @ApiProperty({
    example: "+15551234567",
    description: "The technician's phone number (Twilio's `From`).",
  })
  @Matches(E164_PATTERN, { message: "fromPhone must be a valid E.164 phone number" })
  fromPhone!: string;

  @ApiProperty({ example: "CLAIM" })
  @IsString()
  @Length(1, 160)
  body!: string;
}
