import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Twilio's request-signing scheme (publicly documented): HMAC-SHA1 of the
 * full request URL concatenated with each POST param's key+value, sorted
 * by key, base64-encoded, compared against the `X-Twilio-Signature`
 * header. UNVERIFIED AGAINST A LIVE SANDBOX — same epistemic-honesty
 * caveat as every other external-format implementation in this build (no
 * live Twilio account in this environment to confirm against); the
 * algorithm itself is Twilio's own published spec, not guessed.
 *
 * Found live, not hypothetical, during a final security audit: this
 * previously compared the computed and provided signatures with a plain
 * `===`, a variable-time comparison that leaks how many leading bytes
 * matched via response-timing — exactly the class of bug
 * shared/webhooks/hmac-signature.util.ts's own `timingSafeEqual` usage
 * (the CRM webhook path) already guards against, just missed here since
 * this is a separate, duplicated implementation. `timingSafeEqual` throws
 * on a length mismatch rather than returning false, so the length check
 * happens first — a malformed/truncated header fails cleanly instead of
 * crashing this route's authentication entirely.
 */
export function verifyTwilioSignature(
  url: string,
  params: Record<string, string>,
  signatureHeader: string,
  authToken: string,
): boolean {
  const sortedKeys = Object.keys(params).sort();
  const data = sortedKeys.reduce((acc, key) => acc + key + params[key], url);
  const expected = createHmac("sha1", authToken).update(data, "utf8").digest("base64");
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(signatureHeader);
  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }
  return timingSafeEqual(expectedBuffer, providedBuffer);
}
