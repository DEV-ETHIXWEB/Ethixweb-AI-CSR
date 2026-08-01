import { TwilioSmsSender } from "./twilio-sms.sender";
import type { NotificationPayload } from "../../domain/notification-payload";

const ORIGINAL_ENV = { ...process.env };

function basePayload(): NotificationPayload {
  return {
    leadId: "lead-1",
    priority: "urgent",
    leadType: "residential",
    customerName: "Jane Doe",
    customerPhone: "+15551234567",
    address: "123 Main St",
    problemSummary: "Water heater leaking",
    transcriptLink: null,
  };
}

describe("TwilioSmsSender", () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;
    process.env["TWILIO_ACCOUNT_SID"] = "AC_test";
    process.env["TWILIO_AUTH_TOKEN"] = "test-token";
    process.env["TWILIO_FROM_NUMBER"] = "+15550000000";
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("sends via Twilio's Messages REST API with Basic Auth and returns the message sid", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ sid: "SM123" }), { status: 201 }),
    );
    const sender = new TwilioSmsSender();

    const result = await sender.send({ phone: "+15559999999" }, basePayload());

    expect(result).toEqual({ success: true, providerMessageId: "SM123" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/Accounts/AC_test/Messages.json");
    expect((init.headers as Record<string, string>)["Authorization"]).toContain("Basic ");
  });

  it("fails cleanly when the destination has no phone number", async () => {
    const sender = new TwilioSmsSender();

    const result = await sender.send({}, basePayload());

    expect(result.success).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails cleanly when Twilio credentials aren't configured", async () => {
    delete process.env["TWILIO_ACCOUNT_SID"];
    const sender = new TwilioSmsSender();

    const result = await sender.send({ phone: "+15559999999" }, basePayload());

    expect(result.success).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns a failure result (not a throw) on a non-2xx Twilio response", async () => {
    fetchMock.mockResolvedValueOnce(new Response("bad request", { status: 400 }));
    const sender = new TwilioSmsSender();

    const result = await sender.send({ phone: "+15559999999" }, basePayload());

    expect(result.success).toBe(false);
    expect(result.error).toContain("400");
  });
});
