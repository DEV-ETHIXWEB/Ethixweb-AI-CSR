import { createHmac } from "node:crypto";

/**
 * Identical algorithm to apps/core-api's own
 * modules/notifications/infrastructure/twilio-signature.util.ts (Twilio's
 * publicly documented HMAC-SHA1 request-signing scheme) — duplicated
 * rather than imported because the two services share no runtime code
 * (core-api's copy lives in a module boundary this service cannot reach,
 * and the two features use entirely separate Twilio credentials per
 * docs/39). [Unverified against a live Twilio sandbox — same caveat as the
 * original.]
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
  return expected === signatureHeader;
}
