import { Body, Controller, HttpCode, HttpStatus, Post } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Public } from "../../../shared/auth/public.decorator";
import { HandleSmsClaimReplyUseCase } from "../application/handle-sms-claim-reply.use-case";
import { SmsClaimReplyDto } from "./dto/sms-claim-reply.dto";
import { SmsClaimReplyResponseDto } from "./dto/sms-claim-reply-response.dto";

/**
 * `@Public()` for the same reason as CrmWebhooksController (see its own
 * comment): an SMS provider can't present this platform's own JWT/API key.
 * Accepts the JSON shape SmsClaimReplyDto documents rather than Twilio's
 * native `application/x-www-form-urlencoded` body directly — see that
 * DTO's own comment on the remaining, explicitly-named integration step
 * (a form-body parser) before a live Twilio number can point here.
 * `TwilioSignatureUtil` (infrastructure/twilio-signature.util.ts) is built
 * and tested, ready to wire into this handler once the raw form body is
 * available to verify over — not wired yet, per the same "don't guess at
 * an unverifiable integration" discipline as the rest of this build.
 */
@Public()
@ApiTags("sms-webhooks")
@Controller("webhooks/sms")
export class SmsWebhooksController {
  constructor(private readonly handleSmsClaimReply: HandleSmsClaimReplyUseCase) {}

  @Post("claim-reply")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "docs/07 §4 — inbound 'Reply CLAIM' SMS handler" })
  @ApiResponse({ status: 200, type: SmsClaimReplyResponseDto })
  async receive(@Body() dto: SmsClaimReplyDto): Promise<SmsClaimReplyResponseDto> {
    const outcome = await this.handleSmsClaimReply.execute(dto.fromPhone, dto.body);
    return SmsClaimReplyResponseDto.fromDomain(outcome);
  }
}
