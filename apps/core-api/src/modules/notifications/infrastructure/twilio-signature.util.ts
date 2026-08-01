import { createHmac } from "node:crypto";

/**
 * Twilio's request-signing scheme (publicly documented): HMAC-SHA1 of the
 * full request URL concatenated with each POST param's key+value, sorted
 * by key, base64-encoded, compared against the `X-Twilio-Signature`
 * header. UNVERIFIED AGAINST A LIVE SANDBOX — same epistemic-honesty
 * caveat as every other external-format implementation in this build (no
 * live Twilio account in this environment to confirm against); the
 * algorithm itself is Twilio's own published spec, not guessed.
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
