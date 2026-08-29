import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
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
 * body directly (Nest's FastifyAdapter's own built-in urlencoded parser —
 * see main.ts's own comment on why a manual `@fastify/formbody`
 * registration was removed) via the SmsClaimReplyDto shape that now
 * matches Twilio's own field names
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
  async receive(
    // `body` is deliberately typed as a plain object, NOT `SmsClaimReplyDto`
    // — a real, previously-undiscovered production-breaking bug, found
    // live: main.ts's global ValidationPipe sets `forbidNonWhitelisted:
    // true`, and it runs on EVERY param whose reflected design:paramtype is
    // a class, REGARDLESS of any pipe also attached directly to that param
    // (an earlier attempt at this fix — `@Body(new ValidationPipe({
    // whitelist: true }))` on a `dto: SmsClaimReplyDto` param — was proven
    // live to NOT fix the bug for exactly this reason: both pipes run, and
    // the global one's `forbidNonWhitelisted: true` still rejected the
    // request first). Twilio's real inbound SMS webhook always includes
    // fields this DTO doesn't declare (AccountSid, SmsSid, NumMedia,
    // NumSegments, ApiVersion, at minimum — and conditionally
    // FromCity/FromState/etc. when geodata is enabled, MessagingServiceSid
    // when using a Messaging Service), and can add more over time —
    // enumerating them all would be exactly as fragile as the bug this
    // fixes. Declaring the param type as a plain object (not a class) makes
    // Nest's reflected design:paramtype `Object`, which the global
    // ValidationPipe's own `toValidate()` check always skips (its documented
    // built-in exclusion list) — so the global pipe never touches this
    // param, and validation/transformation is instead done explicitly below
    // with `whitelist: true` only (still safely strips undeclared fields
    // pre-validation) and no `forbidNonWhitelisted`. Verified live: the
    // identical realistic Twilio-shaped payload that previously got a 400
    // from both the broken original AND the broken first fix attempt now
    // reaches the use case correctly.
    @Body() body: Record<string, unknown>,
  ): Promise<SmsClaimReplyResponseDto> {
    const dto = plainToInstance(SmsClaimReplyDto, body);
    const errors = await validate(dto, { whitelist: true });
    if (errors.length > 0) {
      throw new BadRequestException(
        errors.flatMap((error) => Object.values(error.constraints ?? {})),
      );
    }

    const outcome = await this.handleSmsClaimReply.execute(dto.From, dto.Body);
    return SmsClaimReplyResponseDto.fromDomain(outcome);
  }
}
