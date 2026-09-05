import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * FOUND LIVE via a QA security audit, not a real incident: `/media-stream`
 * (media-stream.gateway.ts) is a raw WebSocket route registered directly
 * on Fastify, completely separate from `TwilioVoiceController`'s own
 * `POST /webhooks/twilio/voice` — the ONLY thing Twilio's own signature
 * scheme (twilio-signature.guard.ts) actually protects. Twilio's Media
 * Stream protocol carries `tenantId`/`businessId`/`callerAni`/`callId`
 * back as plain `customParameters` on the WebSocket's own `start` event,
 * with nothing tying that connection back to a genuinely
 * signature-verified webhook request — anyone who can reach the public
 * WebSocket URL (no auth of any kind previously) could open a raw
 * connection, send a forged `start` event with an arbitrary tenantId,
 * and stream fabricated audio straight into a real tenant's
 * conversation, bypassing the Twilio signature guard, tenant routing,
 * and every downstream authorization check entirely — plus reserve real
 * capacity against the shared global concurrent-call ceiling with zero
 * credentials, a live unauthenticated DoS lever.
 *
 * Fix: `TwilioVoiceController` — which already ran behind
 * `TwilioSignatureGuard`, so reaching this code at all already proves
 * the request came from Twilio — mints an HMAC over the EXACT call
 * parameters it's about to embed as Stream `<Parameter>`s, keyed by the
 * SAME `TWILIO_AUTH_TOKEN` secret already used for Twilio's own request
 * signature (reusing it is deliberate: this token's only job is proving
 * "these parameter values came from a request that already passed that
 * verification," not a separate secret to provision/rotate). The token
 * itself becomes one more Stream `<Parameter>`. `MediaStreamGateway`
 * recomputes the SAME HMAC over the customParameters it actually
 * receives and rejects the connection before ever calling
 * `onCallStart` if the token is missing or doesn't match — binding the
 * check to the EXACT values received, not just "a token was present," so
 * an attacker can't replay a valid token alongside different forged
 * parameter values.
 *
 * Same algorithm shape as twilio-signature.util.ts (sorted-key canonical
 * serialization, HMAC, constant-time comparison) for consistency, not
 * copy-paste — deliberately SHA-256 (not Twilio's own SHA-1), since this
 * is this service's own internal scheme, not a wire-compatibility
 * requirement with Twilio's documented algorithm.
 */
export function signMediaStreamParams(params: Record<string, string>, authToken: string): string {
  const sortedKeys = Object.keys(params).sort();
  const data = sortedKeys.reduce((acc, key) => acc + key + params[key], "");
  return createHmac("sha256", authToken).update(data, "utf8").digest("base64");
}

export function verifyMediaStreamToken(
  params: Record<string, string>,
  providedToken: string,
  authToken: string,
): boolean {
  const expected = signMediaStreamParams(params, authToken);
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(providedToken);
  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }
  return timingSafeEqual(expectedBuffer, providedBuffer);
}
