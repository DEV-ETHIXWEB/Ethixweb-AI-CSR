import { createHmac } from "node:crypto";
import { GenericWebhookSender } from "./generic-webhook.sender";
import type { NotificationPayload } from "../../domain/notification-payload";

function basePayload(): NotificationPayload {
  return {
    leadId: "lead-1",
    priority: "routine",
    leadType: "residential",
    customerName: "Jane Doe",
    customerPhone: "+15551234567",
    address: "123 Main St",
    problemSummary: "Leaky faucet",
    transcriptLink: null,
  };
}

describe("GenericWebhookSender", () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });

  it("POSTs the raw NotificationPayload as JSON", async () => {
    fetchMock.mockResolvedValueOnce(new Response("ok", { status: 200 }));
    const sender = new GenericWebhookSender();

    const result = await sender.send(
      { webhookUrl: "https://tenant.example.com/hook" },
      basePayload(),
    );

    expect(result).toEqual({ success: true });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as NotificationPayload;
    expect(body.leadId).toBe("lead-1");
  });

  it("signs the body with X-Signature when a webhookSecret is configured", async () => {
    fetchMock.mockResolvedValueOnce(new Response("ok", { status: 200 }));
    const sender = new GenericWebhookSender();
    const payload = basePayload();

    await sender.send(
      { webhookUrl: "https://tenant.example.com/hook", webhookSecret: "s3cret" },
      payload,
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    const expectedSignature = `sha256=${createHmac("sha256", "s3cret")
      .update(init.body as string)
      .digest("hex")}`;
    expect(headers["X-Signature"]).toBe(expectedSignature);
  });

  it("omits X-Signature when no webhookSecret is configured", async () => {
    fetchMock.mockResolvedValueOnce(new Response("ok", { status: 200 }));
    const sender = new GenericWebhookSender();

    await sender.send({ webhookUrl: "https://tenant.example.com/hook" }, basePayload());

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["X-Signature"]).toBeUndefined();
  });

  it("fails cleanly when no webhookUrl is configured", async () => {
    const sender = new GenericWebhookSender();

    const result = await sender.send({}, basePayload());

    expect(result.success).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  /**
   * Regression coverage for a real bug found live: this call had no
   * timeout at all, same unbounded-fetch bug class found and fixed for
   * the live-call path this session (HttpCoreApiClient, FallbackAiProvider,
   * HttpOrchestratorClient, TwilioCallTransferProvider). A tenant-configured
   * URL hanging would have stalled SendLeadNotificationUseCase's per-channel
   * send indefinitely rather than failing within its own 3-attempt retry
   * budget.
   */
  it("bounds the request with a timeout, so a hung receiver is never left completely unbounded", async () => {
    fetchMock.mockResolvedValueOnce(new Response("ok", { status: 200 }));
    const sender = new GenericWebhookSender();

    await sender.send({ webhookUrl: "https://tenant.example.com/hook" }, basePayload());

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.signal?.aborted).toBe(false);
  });
});
