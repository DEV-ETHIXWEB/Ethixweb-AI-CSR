import { Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { InvalidTwilioSignatureError } from "../../domain/errors";
import { verifyTwilioSignature } from "../../infrastructure/twilio-signature.util";

/**
 * Lives alongside AuthGuard/RolesGuard's own location convention
 * (modules/auth/interfaces/guards/) rather than shared/auth/ — this guard
 * is specific to one module's one route, not a cross-module primitive, and
 * shared/ may not depend on any module's domain/infrastructure layers
 * (eslint-plugin-boundaries, docs/14-backend-stack-and-code-standards.md §2).
 *
 * Twilio's own recommended inbound-webhook check (docs/08-security-observability-reliability.md
 * §1.3) — reconstructs the exact URL Twilio signed against plus the
 * form-decoded POST params (available on `request.body` once Nest's
 * FastifyAdapter's own built-in urlencoded parser has parsed them — see
 * main.ts's own comment), and rejects with 403
 * (InvalidTwilioSignatureError) rather than the platform's usual 401 for a
 * missing/invalid *platform* credential: Twilio can never present a JWT or
 * `X-Api-Key` (see SmsWebhooksController's own `@Public()` comment), so this
 * guard — not AuthGuard — IS this route's authentication.
 *
 * Fails closed if `TWILIO_AUTH_TOKEN` isn't configured: a missing secret
 * must never be treated as "verification not required," or anyone could
 * post directly to this endpoint in an environment where the operator
 * simply forgot to set the var.
 *
 * URL reconstruction uses Fastify's own `request.protocol`/`hostname`/`url`
 * — correct only if the Fastify adapter is configured to trust the
 * `X-Forwarded-*` headers a real ALB/proxy sets in front of it (`trustProxy`
 * on FastifyAdapter, not currently set in main.ts). Not addressed here:
 * that's a deployment-topology concern for whoever wires up the ALB, not
 * something this guard can verify without one. Same "no live Twilio
 * account, epistemic honesty about what's unverified" caveat as
 * twilio-signature.util.ts itself — this guard's logic is unit-tested
 * against hand-constructed signatures, never against a live Twilio request.
 */
@Injectable()
export class TwilioSignatureGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
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
    const url = `${request.protocol}://${request.hostname}${request.url}`;

    if (!verifyTwilioSignature(url, params, signatureHeader, authToken)) {
      throw new InvalidTwilioSignatureError();
    }

    return true;
  }
}

/**
 * Nest's FastifyAdapter's own built-in urlencoded parser (see main.ts's
 * own comment) parses `application/x-www-form-urlencoded` bodies into a
 * plain string-keyed object — Twilio never sends repeated keys or nested
 * structures on this webhook, so a defensive type-check per value (rather
 * than trusting the parser's inferred type) is enough without pulling in
 * the DTO/class-validator pipeline just to compute a signature.
 */
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
