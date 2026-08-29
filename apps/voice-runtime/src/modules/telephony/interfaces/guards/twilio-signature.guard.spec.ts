import { createHmac } from "node:crypto";
import type { ExecutionContext } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { InvalidTwilioSignatureError } from "../../domain/errors";
import { TwilioSignatureGuard } from "./twilio-signature.guard";

const ORIGINAL_ENV = { ...process.env };

const AUTH_TOKEN = "test-auth-token";
const PUBLIC_BASE_URL = "https://runtime.ngrok.example.com";
const PATH = "/webhooks/twilio/voice";
const FORM_PARAMS = { From: "+15551234567", To: "+15559999999", CallSid: "CAxxxx" };

function computeSignature(
  params: Record<string, string> = FORM_PARAMS,
  token: string = AUTH_TOKEN,
): string {
  const url = `${PUBLIC_BASE_URL}${PATH}`;
  const sortedKeys = Object.keys(params).sort();
  const data = sortedKeys.reduce((acc, key) => acc + key + params[key], url);
  return createHmac("sha1", token).update(data, "utf8").digest("base64");
}

function buildContext(request: Partial<FastifyRequest>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => (): void => undefined,
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

function buildRequest(overrides: Partial<FastifyRequest> = {}): FastifyRequest {
  return {
    url: PATH,
    body: FORM_PARAMS,
    headers: { "x-twilio-signature": computeSignature() },
    ...overrides,
  } as unknown as FastifyRequest;
}

describe("TwilioSignatureGuard", () => {
  beforeEach(() => {
    process.env["TWILIO_AUTH_TOKEN"] = AUTH_TOKEN;
    process.env["PUBLIC_BASE_URL"] = PUBLIC_BASE_URL;
    delete process.env["TWILIO_SIGNATURE_VALIDATION_DISABLED"];
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("allows a request whose X-Twilio-Signature matches PUBLIC_BASE_URL + path + form params", () => {
    const guard = new TwilioSignatureGuard();
    const context = buildContext(buildRequest());

    expect(guard.canActivate(context)).toBe(true);
  });

  it("rejects a tampered/incorrect signature with InvalidTwilioSignatureError", () => {
    const guard = new TwilioSignatureGuard();
    const request = buildRequest({ headers: { "x-twilio-signature": "not-the-real-signature" } });
    const context = buildContext(request);

    expect(() => guard.canActivate(context)).toThrow(InvalidTwilioSignatureError);
  });

  it("rejects a request with no X-Twilio-Signature header at all", () => {
    const guard = new TwilioSignatureGuard();
    const request = buildRequest({ headers: {} });
    const context = buildContext(request);

    expect(() => guard.canActivate(context)).toThrow(InvalidTwilioSignatureError);
  });

  it("rejects a signature computed over different form params than were actually posted", () => {
    const guard = new TwilioSignatureGuard();
    const tamperedSignature = computeSignature({ ...FORM_PARAMS, CallSid: "CAyyyy" });
    const request = buildRequest({ headers: { "x-twilio-signature": tamperedSignature } });
    const context = buildContext(request);

    expect(() => guard.canActivate(context)).toThrow(InvalidTwilioSignatureError);
  });

  it("fails closed (rejects, does not skip verification) when TWILIO_AUTH_TOKEN is not configured", () => {
    delete process.env["TWILIO_AUTH_TOKEN"];
    const guard = new TwilioSignatureGuard();
    const context = buildContext(buildRequest());

    expect(() => guard.canActivate(context)).toThrow(InvalidTwilioSignatureError);
  });

  it("bypasses verification entirely when TWILIO_SIGNATURE_VALIDATION_DISABLED=true (local ngrok testing escape hatch)", () => {
    process.env["TWILIO_SIGNATURE_VALIDATION_DISABLED"] = "true";
    delete process.env["TWILIO_AUTH_TOKEN"];
    const guard = new TwilioSignatureGuard();
    const request = buildRequest({ headers: {} });
    const context = buildContext(request);

    expect(guard.canActivate(context)).toBe(true);
  });

  it("does NOT bypass on any value other than the literal string 'true'", () => {
    process.env["TWILIO_SIGNATURE_VALIDATION_DISABLED"] = "1";
    const guard = new TwilioSignatureGuard();
    const request = buildRequest({ headers: {} });
    const context = buildContext(request);

    expect(() => guard.canActivate(context)).toThrow(InvalidTwilioSignatureError);
  });

  /**
   * Regression coverage for a real bug found live during a security audit:
   * env.schema.ts's own comment on TWILIO_SIGNATURE_VALIDATION_DISABLED
   * claims "never allow it in production (enforced in the guard itself,
   * not just documented here)" — but the guard previously had no NODE_ENV
   * check at all, only the literal flag value. A copy-pasted .env from a
   * staging/ngrok setup landing in a NODE_ENV=production deployment would
   * have silently disabled the sole authentication on this public
   * telephony webhook.
   */
  it("NEVER bypasses in production, even if the escape hatch is set to true (env.schema.ts's own documented guarantee, now actually enforced)", () => {
    process.env["TWILIO_SIGNATURE_VALIDATION_DISABLED"] = "true";
    process.env["NODE_ENV"] = "production";
    delete process.env["TWILIO_AUTH_TOKEN"];
    const guard = new TwilioSignatureGuard();
    const request = buildRequest({ headers: {} });
    const context = buildContext(request);

    expect(() => guard.canActivate(context)).toThrow(InvalidTwilioSignatureError);
  });
});
