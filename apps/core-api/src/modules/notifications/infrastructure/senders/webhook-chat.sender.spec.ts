import { SlackWebhookSender, TeamsWebhookSender } from "./webhook-chat.sender";
import type { NotificationPayload } from "../../domain/notification-payload";

function basePayload(): NotificationPayload {
  return {
    leadId: "lead-1",
    priority: "emergency",
    leadType: "commercial",
    customerName: "Jane Doe",
    customerPhone: "+15551234567",
    address: "123 Main St",
    problemSummary: "Gas leak",
    transcriptLink: null,
  };
}

describe.each([
  ["SlackWebhookSender", new SlackWebhookSender(), "slack"],
  ["TeamsWebhookSender", new TeamsWebhookSender(), "teams"],
] as const)("%s", (_name, sender, expectedChannelType) => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });

  it(`has channelType "${expectedChannelType}"`, () => {
    expect(sender.channelType).toBe(expectedChannelType);
  });

  it("POSTs a plain-text block message to the configured webhook URL", async () => {
    fetchMock.mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const result = await sender.send({ webhookUrl: "https://hooks.example.com/x" }, basePayload());

    expect(result).toEqual({ success: true });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://hooks.example.com/x");
    const body = JSON.parse(init.body as string) as { text: string };
    expect(body.text).toContain("Jane Doe");
  });

  it("fails cleanly when no webhookUrl is configured", async () => {
    const result = await sender.send({}, basePayload());

    expect(result.success).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns a failure result on a non-2xx response", async () => {
    fetchMock.mockResolvedValueOnce(new Response("error", { status: 500 }));

    const result = await sender.send({ webhookUrl: "https://hooks.example.com/x" }, basePayload());

    expect(result.success).toBe(false);
  });
});
