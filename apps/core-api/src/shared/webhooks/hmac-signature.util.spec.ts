import { createHmac } from "node:crypto";
import { isTimestampWithinTolerance, verifyHmacSignature } from "./hmac-signature.util";

const SECRET = "test-webhook-secret";

function sign(payload: string, secret = SECRET): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

describe("verifyHmacSignature", () => {
  it("accepts a correctly signed payload", () => {
    const payload = JSON.stringify({ event: "lead.created", id: "lead-1" });
    const signature = sign(payload);

    expect(verifyHmacSignature(payload, signature, SECRET)).toBe(true);
  });

  it("accepts a signature with a common provider prefix (sha256=...)", () => {
    const payload = JSON.stringify({ event: "lead.created" });
    const signature = `sha256=${sign(payload)}`;

    expect(verifyHmacSignature(payload, signature, SECRET)).toBe(true);
  });

  it("rejects a payload signed with the wrong secret", () => {
    const payload = JSON.stringify({ event: "lead.created" });
    const signature = sign(payload, "a-different-secret");

    expect(verifyHmacSignature(payload, signature, SECRET)).toBe(false);
  });

  it("rejects a tampered payload even with a validly-formatted signature copied from elsewhere", () => {
    const originalPayload = JSON.stringify({ amount: 100 });
    const signature = sign(originalPayload);
    const tamperedPayload = JSON.stringify({ amount: 100000 });

    expect(verifyHmacSignature(tamperedPayload, signature, SECRET)).toBe(false);
  });

  it("rejects a malformed (non-hex) signature header instead of throwing", () => {
    const payload = JSON.stringify({ event: "lead.created" });

    expect(verifyHmacSignature(payload, "not-a-valid-hex-signature!!", SECRET)).toBe(false);
  });

  it("rejects an empty signature header", () => {
    expect(verifyHmacSignature("payload", "", SECRET)).toBe(false);
  });

  it("works against a Buffer payload identically to the equivalent string", () => {
    const payload = JSON.stringify({ event: "lead.created" });
    const signature = sign(payload);

    expect(verifyHmacSignature(Buffer.from(payload, "utf-8"), signature, SECRET)).toBe(true);
  });
});

describe("isTimestampWithinTolerance", () => {
  const now = new Date("2026-07-29T12:00:00Z");

  it("accepts a timestamp exactly now", () => {
    expect(isTimestampWithinTolerance(now.getTime() / 1000, 300, now)).toBe(true);
  });

  it("accepts a timestamp within tolerance in the past", () => {
    const timestamp = now.getTime() / 1000 - 200;
    expect(isTimestampWithinTolerance(timestamp, 300, now)).toBe(true);
  });

  it("accepts a timestamp within tolerance in the future (clock skew)", () => {
    const timestamp = now.getTime() / 1000 + 200;
    expect(isTimestampWithinTolerance(timestamp, 300, now)).toBe(true);
  });

  it("rejects a timestamp older than the tolerance window — the replay-protection case", () => {
    const timestamp = now.getTime() / 1000 - 600;
    expect(isTimestampWithinTolerance(timestamp, 300, now)).toBe(false);
  });

  it("rejects a timestamp too far in the future", () => {
    const timestamp = now.getTime() / 1000 + 600;
    expect(isTimestampWithinTolerance(timestamp, 300, now)).toBe(false);
  });

  it("accepts exactly at the tolerance boundary", () => {
    const timestamp = now.getTime() / 1000 - 300;
    expect(isTimestampWithinTolerance(timestamp, 300, now)).toBe(true);
  });
});
