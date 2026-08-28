import { Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { InvalidTwilioSignatureError } from "../../domain/errors";
import { verifyTwilioSignature } from "../../infrastructure/twilio-signature.util";

/**
 * Mirrors apps/core-api's TwilioSignatureGuard exactly (read directly
 * before writing this) — this service's OWN Twilio credential
 * (TWILIO_AUTH_TOKEN, never core-api's same-named-but-unrelated var per
 * docs/39), fails closed if unconfigured, rejects with 403 not 401 (Twilio
 * can never present this platform's own service bearer token — see
 * ServiceAuthGuard's own comment on why THAT guard exists for
 * service-to-service calls, not Twilio's webhook).
 *
 * `TWILIO_SIGNATURE_VALIDATION_DISABLED` (env.schema.ts) is this guard's
 * one deliberate escape hatch, for local ngrok testing per docs/41 — never
 * true by default, and the check below still requires it be the literal
 * string match, not merely "truthy env var present."
 */
@Injectable()
export class TwilioSignatureGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (process.env["TWILIO_SIGNATURE_VALIDATION_DISABLED"] === "true") {
      return true;
    }

    const request = context.switchToHttp().getRequest<FastifyRequest>();

    const authToken = process.env["TWILIO_AUTH_TOKEN"];
    if (!authToken) {
      throw new InvalidTwilioSignatureError();
    }

    const signatureHeader = request.headers["x-twilio-signature"];
    if (typeof signatureHeader !== "string" || signatureHeader.length === 0) {
      throw new InvalidTwilioSignatureError();
    }

    const params = extractFormParams(request.body);
    // PUBLIC_BASE_URL (not request.protocol/hostname) reconstructs the
    // exact URL Twilio itself dialed — correct behind an ngrok tunnel or a
    // real ALB/CloudFront without depending on X-Forwarded-* trust
    // configuration, which core-api's own guard flags as an unresolved
    // deployment-topology gap (docs/24 §4). This service closes that gap
    // for itself by using its own known public URL rather than
    // reconstructing one from request headers.
    const publicBaseUrl = (process.env["PUBLIC_BASE_URL"] ?? "").replace(/\/+$/, "");
    const url = `${publicBaseUrl}${request.url}`;

    if (!verifyTwilioSignature(url, params, signatureHeader, authToken)) {
      throw new InvalidTwilioSignatureError();
    }

    return true;
  }
}

/** Identical to core-api's own extractFormParams — Nest's FastifyAdapter's own built-in urlencoded parser (see main.ts's own comment) parses application/x-www-form-urlencoded into a flat string-keyed object; Twilio never sends nested/repeated keys on this webhook. */
function extractFormParams(body: unknown): Record<string, string> {
  if (typeof body !== "object" || body === null) {
    return {};
  }
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (typeof value === "string") {
      params[key] = value;
    }
  }
  return params;
}
