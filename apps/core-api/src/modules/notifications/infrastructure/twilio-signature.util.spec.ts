import { createHmac } from "node:crypto";
import { verifyTwilioSignature } from "./twilio-signature.util";

describe("verifyTwilioSignature", () => {
  const authToken = "test-auth-token";
  const url = "https://example.com/webhooks/sms/claim-reply";
  const params = { From: "+15551234567", To: "+15559999999", Body: "CLAIM" };

  function computeExpected(): string {
    const sortedKeys = Object.keys(params).sort();
    const data = sortedKeys.reduce(
      (acc, key) => acc + key + (params as Record<string, string>)[key],
      url,
    );
    return createHmac("sha1", authToken).update(data, "utf8").digest("base64");
  }

  it("accepts a correctly computed signature", () => {
    const signature = computeExpected();

    expect(verifyTwilioSignature(url, params, signature, authToken)).toBe(true);
  });

  it("rejects a tampered signature", () => {
    expect(verifyTwilioSignature(url, params, "not-the-real-signature", authToken)).toBe(false);
  });

  it("rejects when the wrong auth token is used to verify", () => {
    const signature = computeExpected();

    expect(verifyTwilioSignature(url, params, signature, "wrong-token")).toBe(false);
  });
});
