import type { TenantRoutingProvider } from "../../tenant-routing/domain/tenant-routing.port";
import { createNoopLogger } from "../../call-session/application/__fakes__/fake-logger";
import { verifyMediaStreamToken } from "../infrastructure/media-stream-auth.util";
import { TwilioVoiceController } from "./twilio-voice.controller";
import { TwilioVoiceWebhookDto } from "./dto/twilio-voice-webhook.dto";

class FakeTenantRoutingProvider implements TenantRoutingProvider {
  route: { tenantId: string; businessId: string; timezone?: string } | null = {
    tenantId: "tenant-1",
    businessId: "business-1",
    timezone: "America/Chicago",
  };
  resolvedWith: string | null = null;

  async resolve(toNumber: string) {
    this.resolvedWith = toNumber;
    return this.route;
  }
}

describe("TwilioVoiceController", () => {
  const originalEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  function payload(overrides: Partial<TwilioVoiceWebhookDto> = {}): TwilioVoiceWebhookDto {
    const dto = new TwilioVoiceWebhookDto();
    dto.CallSid = "CAxxxx";
    dto.From = "+15551234567";
    dto.To = "+15559876543";
    return Object.assign(dto, overrides);
  }

  it("returns <Connect><Stream> TwiML carrying tenant/business/callerAni resolved from the dialed number", async () => {
    process.env["PUBLIC_BASE_URL"] = "https://runtime.ngrok.example.com";
    process.env["TWILIO_AUTH_TOKEN"] = "test-auth-token";
    const tenantRouting = new FakeTenantRoutingProvider();
    const controller = new TwilioVoiceController(tenantRouting, createNoopLogger());

    const twiml = await controller.voice(payload());

    expect(tenantRouting.resolvedWith).toBe("+15559876543");
    expect(twiml).toContain("<Connect>");
    expect(twiml).toContain('<Stream url="wss://runtime.ngrok.example.com/media-stream">');
    expect(twiml).toContain('<Parameter name="tenantId" value="tenant-1" />');
    expect(twiml).toContain('<Parameter name="businessId" value="business-1" />');
    expect(twiml).toContain('<Parameter name="callerAni" value="+15551234567" />');
  });

  it("generates a fresh callId on every invocation (docs/28 §B.1)", async () => {
    process.env["PUBLIC_BASE_URL"] = "https://runtime.ngrok.example.com";
    process.env["TWILIO_AUTH_TOKEN"] = "test-auth-token";
    const tenantRouting = new FakeTenantRoutingProvider();
    const controller = new TwilioVoiceController(tenantRouting, createNoopLogger());

    const first = await controller.voice(payload());
    const second = await controller.voice(payload());

    const extractCallId = (twiml: string): string =>
      /name="callId" value="([^"]+)"/.exec(twiml)?.[1] ?? "";
    expect(extractCallId(first)).not.toBe(extractCallId(second));
    expect(extractCallId(first)).toHaveLength(36); // UUID
  });

  /**
   * QA security audit finding: `/media-stream` (the raw WebSocket route)
   * had zero authentication of its own — anyone reaching the public URL
   * could forge a `start` event with an arbitrary tenantId/businessId,
   * bypassing TwilioSignatureGuard entirely (that guard only protects
   * THIS webhook POST, a separate HTTP request). This proves the TwiML
   * this controller emits actually carries a token that
   * media-stream.gateway.ts can verify, and that the token is genuinely
   * bound to the exact parameter values sent — not just present.
   */
  it("includes a mediaStreamToken Stream Parameter that verifies against the exact call parameters emitted", async () => {
    process.env["PUBLIC_BASE_URL"] = "https://runtime.ngrok.example.com";
    process.env["TWILIO_AUTH_TOKEN"] = "test-auth-token";
    const tenantRouting = new FakeTenantRoutingProvider();
    const controller = new TwilioVoiceController(tenantRouting, createNoopLogger());

    const twiml = await controller.voice(payload());

    const extract = (name: string): string =>
      new RegExp(`name="${name}" value="([^"]+)"`).exec(twiml)?.[1] ?? "";
    const token = extract("mediaStreamToken");
    expect(token.length).toBeGreaterThan(0);
    const params = {
      callId: extract("callId"),
      tenantId: extract("tenantId"),
      businessId: extract("businessId"),
      callerAni: extract("callerAni"),
      toNumber: extract("toNumber"),
      timezone: extract("timezone"),
    };
    expect(verifyMediaStreamToken(params, token, "test-auth-token")).toBe(true);
    // A forged connection presenting different parameter values alongside
    // this SAME valid-looking token must NOT verify — proves the token is
    // bound to the actual values, not just "some token was present."
    expect(
      verifyMediaStreamToken({ ...params, tenantId: "attacker-tenant" }, token, "test-auth-token"),
    ).toBe(false);
  });

  it("returns the apology TwiML (never an unsigned <Connect><Stream>) when TWILIO_AUTH_TOKEN is missing at request time", async () => {
    process.env["PUBLIC_BASE_URL"] = "https://runtime.ngrok.example.com";
    delete process.env["TWILIO_AUTH_TOKEN"];
    const tenantRouting = new FakeTenantRoutingProvider();
    const controller = new TwilioVoiceController(tenantRouting, createNoopLogger());

    const twiml = await controller.voice(payload());

    expect(twiml).not.toContain("<Connect>");
    expect(twiml).toContain("<Say>");
  });

  it("returns the apology TwiML (never throws) when no tenant route is configured for the dialed number", async () => {
    process.env["PUBLIC_BASE_URL"] = "https://runtime.ngrok.example.com";
    const tenantRouting = new FakeTenantRoutingProvider();
    tenantRouting.route = null;
    const controller = new TwilioVoiceController(tenantRouting, createNoopLogger());

    const twiml = await controller.voice(payload());

    expect(twiml).toContain("<Say>");
    expect(twiml).toContain("<Hangup/>");
  });

  it(
    "KILL SWITCH: when AI_RECEPTIONIST_ENABLED=false, dials HUMAN_FALLBACK_NUMBER directly and " +
      "never touches tenant routing at all — the operational runbook for disabling the AI " +
      "receptionist mid-incident (docs/19) is exactly this env var, checked first, before " +
      "anything else that could itself be part of the incident",
    async () => {
      process.env["PUBLIC_BASE_URL"] = "https://runtime.ngrok.example.com";
      process.env["AI_RECEPTIONIST_ENABLED"] = "false";
      process.env["HUMAN_FALLBACK_NUMBER"] = "+15550001234";
      const tenantRouting = new FakeTenantRoutingProvider();
      const controller = new TwilioVoiceController(tenantRouting, createNoopLogger());

      const twiml = await controller.voice(payload());

      expect(twiml).toContain("<Dial>+15550001234</Dial>");
      expect(twiml).not.toContain("<Connect>");
      expect(tenantRouting.resolvedWith).toBeNull();
    },
  );
});
