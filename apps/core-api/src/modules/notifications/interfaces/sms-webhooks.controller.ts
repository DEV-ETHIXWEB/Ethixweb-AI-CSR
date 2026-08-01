import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Public } from "../../../shared/auth/public.decorator";
import { HandleSmsClaimReplyUseCase } from "../application/handle-sms-claim-reply.use-case";
import { TwilioSignatureGuard } from "./guards/twilio-signature.guard";
import { SmsClaimReplyDto } from "./dto/sms-claim-reply.dto";
import { SmsClaimReplyResponseDto } from "./dto/sms-claim-reply-response.dto";

/**
 * `@Public()` for the same reason as CrmWebhooksController (see its own
 * comment): an SMS provider can't present this platform's own JWT/API key
 * — `TwilioSignatureGuard` below is this route's actual authentication.
 * Accepts Twilio's real `application/x-www-form-urlencoded` inbound-SMS
 * body directly (`@fastify/formbody` registered in main.ts) via the
 * SmsClaimReplyDto shape that now matches Twilio's own field names
 * (`From`/`To`/`Body`/`MessageSid` — see that DTO's own comment). Twilio
 * field names are mapped to HandleSmsClaimReplyUseCase's existing
 * (fromPhone, body) signature inline below rather than changing that use
 * case, so this integration step doesn't cascade through code that has
 * nothing to do with Twilio's specific wire format.
 *
 * UNVERIFIED AGAINST A LIVE TWILIO SANDBOX — no live Twilio account or
 * phone number in this environment to send a real webhook request through
 * this handler. TwilioSignatureGuard and twilio-signature.util.ts are each
 * unit-tested against hand-constructed requests/signatures computed with
 * the same published algorithm Twilio uses, which is the strongest
 * verification possible without one — not the same as confirming against
 * a real inbound request, and this comment says so rather than overclaiming.
 */
@Public()
@UseGuards(TwilioSignatureGuard)
@ApiTags("sms-webhooks")
@Controller("webhooks/sms")
export class SmsWebhooksController {
  constructor(private readonly handleSmsClaimReply: HandleSmsClaimReplyUseCase) {}

  @Post("claim-reply")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "docs/07 §4 — inbound 'Reply CLAIM' SMS handler" })
  @ApiResponse({ status: 200, type: SmsClaimReplyResponseDto })
  @ApiResponse({ status: 403, description: "Twilio signature verification failed" })
  async receive(@Body() dto: SmsClaimReplyDto): Promise<SmsClaimReplyResponseDto> {
    const outcome = await this.handleSmsClaimReply.execute(dto.From, dto.Body);
    return SmsClaimReplyResponseDto.fromDomain(outcome);
  }
}
