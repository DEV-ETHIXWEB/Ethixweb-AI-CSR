import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Identical algorithm to apps/core-api's own
 * modules/notifications/infrastructure/twilio-signature.util.ts (Twilio's
 * publicly documented HMAC-SHA1 request-signing scheme) — duplicated
 * rather than imported because the two services share no runtime code
 * (core-api's copy lives in a module boundary this service cannot reach,
 * and the two features use entirely separate Twilio credentials per
 * docs/39). [Unverified against a live Twilio sandbox — same caveat as the
 * original.]
 *
 * Found live during a final security audit: this previously compared the
 * computed and provided signatures with a plain `===`, a variable-time
 * comparison that leaks how many leading bytes matched via response
 * timing — fixed the same way as core-api's copy (see that file's own
 * comment for the full rationale), keeping both duplicated
 * implementations consistent.
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
