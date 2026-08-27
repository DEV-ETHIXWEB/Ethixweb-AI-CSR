import type { TenantRoutingProvider } from "../../tenant-routing/domain/tenant-routing.port";
import { createNoopLogger } from "../../call-session/application/__fakes__/fake-logger";
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
    const tenantRouting = new FakeTenantRoutingProvider();
    const controller = new TwilioVoiceController(tenantRouting, createNoopLogger());

    const first = await controller.voice(payload());
    const second = await controller.voice(payload());

    const extractCallId = (twiml: string): string =>
      /name="callId" value="([^"]+)"/.exec(twiml)?.[1] ?? "";
    expect(extractCallId(first)).not.toBe(extractCallId(second));
    expect(extractCallId(first)).toHaveLength(36); // UUID
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
});
