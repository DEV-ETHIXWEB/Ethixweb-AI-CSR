import { Controller, HttpCode, HttpStatus, Param, Post, Req } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import type { FastifyRequest } from "fastify";
import { IsIn, IsUUID } from "class-validator";
import { Public } from "../../../shared/auth/public.decorator";
import { ReceiveCrmWebhookUseCase } from "../application/receive-crm-webhook.use-case";
import { CRM_TYPES } from "./dto/connect-integration.dto";

type FastifyRequestWithRawBody = FastifyRequest & { rawBody?: Buffer };

class CrmWebhookParamsDto {
  @IsIn(CRM_TYPES)
  crmType!: (typeof CRM_TYPES)[number];

  @IsUUID()
  tenantId!: string;

  @IsUUID()
  integrationId!: string;
}

/**
 * `@Public()` — a vendor webhook can't present this platform's own JWT/API
 * key, so signature verification (delegated to the resolved adapter,
 * inside ReceiveCrmWebhookUseCase) IS the authentication here, not an
 * absence of it. `tenantId`/`integrationId` come from the URL path itself
 * — see ReceiveCrmWebhookUseCase's own comment on why that's a sound,
 * deliberate design, not a shortcut around real auth.
 *
 * Reads `request.rawBody` (enabled via `rawBody: true` on the Fastify
 * adapter in main.ts) rather than `@Body()` — signature verification MUST
 * run over the exact, unparsed bytes the sender signed, not a re-serialized
 * JSON object (shared/webhooks/hmac-signature.util.ts's own comment on why
 * that's a real, common bug, flagged specifically for this HCP case in
 * docs/05-crm-integration.md §2.6).
 */
@Public()
@ApiTags("crm-webhooks")
@Controller("webhooks/crm")
export class CrmWebhooksController {
  constructor(private readonly receiveCrmWebhookUseCase: ReceiveCrmWebhookUseCase) {}

  @Post(":crmType/:tenantId/:integrationId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: "Inbound CRM webhook receiver — HMAC-verified, deduplicated, published to the outbox",
  })
  @ApiResponse({
    status: 204,
    description: "Accepted (including an already-processed redelivery, handled idempotently)",
  })
  @ApiResponse({ status: 401, description: "Invalid or missing webhook signature" })
  @ApiResponse({ status: 404, description: "No such integration, or crmType doesn't match it" })
  async receive(
    @Param() params: CrmWebhookParamsDto,
    @Req() request: FastifyRequestWithRawBody,
  ): Promise<void> {
    // `params` is still validated/transformed by the global ValidationPipe
    // (main.ts) like any other `@Param()` — only the BODY deliberately
    // bypasses `@Body()` (see the class comment on why).
    const rawBody = request.rawBody?.toString("utf8") ?? "";
    await this.receiveCrmWebhookUseCase.execute({
      tenantId: params.tenantId,
      integrationId: params.integrationId,
      crmType: params.crmType,
      headers: request.headers,
      rawBody,
    });
  }
}
