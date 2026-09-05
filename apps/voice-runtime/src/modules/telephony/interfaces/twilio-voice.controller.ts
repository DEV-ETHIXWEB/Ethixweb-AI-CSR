import { randomUUID } from "node:crypto";
import { Body, Controller, Header, Inject, Post, UseGuards } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import type { StructuredLogger } from "@ethixweb/shared-kernel";
import { APP_LOGGER } from "../../../shared/observability/app-logger.module";
import { Public } from "../../../shared/auth/public.decorator";
import {
  TENANT_ROUTING_PROVIDER,
  type TenantRoutingProvider,
} from "../../tenant-routing/domain/tenant-routing.port";
import { UnroutableCallError } from "../domain/errors";
import {
  buildApologyTwiml,
  buildConnectStreamTwiml,
  buildDialHumanTwiml,
} from "../domain/twiml.builder";
import { signMediaStreamParams } from "../infrastructure/media-stream-auth.util";
import { TwilioVoiceWebhookDto } from "./dto/twilio-voice-webhook.dto";
import { TwilioSignatureGuard } from "./guards/twilio-signature.guard";

/**
 * The ONE HTTP entry point a real Twilio account calls — docs/39's own
 * "no Twilio Voice webhook route exists anywhere in this repository" gap,
 * now closed. `@Public()` (bypasses ServiceAuthGuard-equivalent... except
 * this service has none registered globally, see app.module.ts's own
 * comment on why) + `TwilioSignatureGuard` (this route's actual
 * authentication — Twilio can never present a bearer token).
 *
 * Generates `callId` HERE, once, per docs/28 §B.1 ("generate this
 * yourself, once, per call") — NOT in the WebSocket gateway, because
 * Twilio's Media Stream connection is a separate, later WebSocket upgrade
 * this service has no control over the timing of; callId must exist before
 * that connection even opens so it can be threaded through as a Stream
 * <Parameter> (see twiml.builder.ts's own comment).
 */
@Public()
@ApiExcludeController()
@UseGuards(TwilioSignatureGuard)
@Controller("webhooks/twilio")
export class TwilioVoiceController {
  constructor(
    @Inject(TENANT_ROUTING_PROVIDER) private readonly tenantRouting: TenantRoutingProvider,
    @Inject(APP_LOGGER) private readonly logger: StructuredLogger,
  ) {}

  @Post("voice")
  @Header("Content-Type", "text/xml")
  async voice(@Body() body: TwilioVoiceWebhookDto): Promise<string> {
    const callId = randomUUID();
    const log = this.logger.child({ callId, callSid: body.CallSid });

    // The operational kill switch (env.schema.ts's own comment has the
    // full incident-response reasoning) — checked FIRST, before tenant
    // resolution or anything else, so it degrades as little as possible:
    // a caller reaches a human even if tenant routing/config itself is
    // what's broken.
    if (process.env["AI_RECEPTIONIST_ENABLED"] === "false") {
      const destination = process.env["HUMAN_FALLBACK_NUMBER"] ?? "";
      log.warn("AI_RECEPTIONIST_ENABLED=false — forwarding call directly to human fallback", {
        destination,
      });
      return buildDialHumanTwiml(destination);
    }

    const route = body.To ? await this.tenantRouting.resolve(body.To) : null;
    if (!route) {
      log.error("no tenant route for dialed number — returning apology TwiML", {
        toNumber: body.To,
      });
      // Not thrown as UnroutableCallError: Twilio expects a 200 + valid
      // TwiML response on this webhook regardless of what went wrong on
      // this service's side — an HTTP error status here just makes Twilio
      // retry the SAME unroutable request, or play its own generic Twilio
      // error tone to the caller, neither of which is better than this
      // service's own apology message. UnroutableCallError exists for
      // observability/typed-error consistency, not to actually propagate.
      void new UnroutableCallError(body.To ?? "(missing)");
      return buildApologyTwiml();
    }

    const publicBaseUrl = (process.env["PUBLIC_BASE_URL"] ?? "").replace(/^https?:\/\//, "");
    const websocketUrl = `wss://${publicBaseUrl}/media-stream`;

    log.info("inbound call routed", { tenantId: route.tenantId, businessId: route.businessId });

    const callParameters = {
      callId,
      tenantId: route.tenantId,
      businessId: route.businessId,
      callerAni: body.From,
      toNumber: body.To ?? "",
      timezone: route.timezone ?? "",
    };
    // Binds the Media Stream WebSocket connection back to THIS
    // signature-verified webhook request — see media-stream-auth.util.ts's
    // own comment for the full reasoning. Signed over every parameter
    // value, not just present/absent, so a forged connection can't reuse
    // a valid token alongside different tenantId/businessId/callerAni values.
    // Runtime check (not just env.schema.ts's own boot-time validation),
    // matching TwilioSignatureGuard's own defense-in-depth convention for
    // this exact env var, right above in this same request's own guard.
    const authToken = process.env["TWILIO_AUTH_TOKEN"];
    if (!authToken) {
      log.error("TWILIO_AUTH_TOKEN missing at request time — cannot sign media-stream token");
      return buildApologyTwiml();
    }
    const mediaStreamToken = signMediaStreamParams(callParameters, authToken);

    return buildConnectStreamTwiml({
      websocketUrl,
      callParameters: { ...callParameters, mediaStreamToken },
    });
  }
}
