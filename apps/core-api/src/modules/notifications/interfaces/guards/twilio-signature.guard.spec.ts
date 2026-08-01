import { createHmac } from "node:crypto";
import type { ExecutionContext } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { InvalidTwilioSignatureError } from "../../domain/errors";
import { TwilioSignatureGuard } from "./twilio-signature.guard";

const ORIGINAL_ENV = { ...process.env };

const AUTH_TOKEN = "test-auth-token";
const PROTOCOL = "https";
const HOSTNAME = "example.com";
const PATH = "/v1/webhooks/sms/claim-reply";
const FORM_PARAMS = { From: "+15551234567", To: "+15559999999", Body: "CLAIM" };

function computeSignature(
  params: Record<string, string> = FORM_PARAMS,
  token: string = AUTH_TOKEN,
): string {
  const url = `${PROTOCOL}://${HOSTNAME}${PATH}`;
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
    protocol: PROTOCOL,
    hostname: HOSTNAME,
    url: PATH,
    body: FORM_PARAMS,
    headers: { "x-twilio-signature": computeSignature() },
    ...overrides,
  } as unknown as FastifyRequest;
}

describe("TwilioSignatureGuard", () => {
  beforeEach(() => {
    process.env["TWILIO_AUTH_TOKEN"] = AUTH_TOKEN;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("allows a request whose X-Twilio-Signature matches the reconstructed URL + form params", () => {
    const guard = new TwilioSignatureGuard();
    const context = buildContext(buildRequest());

    expect(guard.canActivate(context)).toBe(true);
  });

  it("rejects a tampered/incorrect signature with InvalidTwilioSignatureError", () => {
    const guard = new TwilioSignatureGuard();
    const request = buildRequest({
      headers: { "x-twilio-signature": "not-the-real-signature" },
    });
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
    const tamperedSignature = computeSignature({ ...FORM_PARAMS, Body: "NOT CLAIM" });
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
});
