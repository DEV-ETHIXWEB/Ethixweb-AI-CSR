import { IsOptional, IsString } from "class-validator";

/**
 * Twilio's inbound Voice webhook POST body — form-encoded, not JSON
 * (`@fastify/formbody`, see main.ts). Only the fields this controller
 * actually reads are declared; Twilio sends many more (AccountSid,
 * ApiVersion, CallStatus, etc.) that `whitelist: true` strips silently
 * rather than rejecting — this webhook must never 400 a real inbound call
 * over an unrecognized field Twilio's own platform added, unlike the
 * strict `forbidNonWhitelisted` posture voice-orchestrator's OWN contract
 * uses for its trusted service-to-service callers (docs/24: a hostile/
 * malformed service caller SHOULD 400; Twilio's webhook body evolving is
 * not hostility).
 */
export class TwilioVoiceWebhookDto {
  @IsString()
  CallSid!: string;

  @IsString()
  From!: string;

  @IsOptional()
  @IsString()
  To?: string;
}
