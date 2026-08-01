import {
  renderChatMessage,
  renderEmail,
  renderGenericWebhook,
  renderSms,
} from "./notification-renderers";
import type { NotificationPayload } from "./notification-payload";

function basePayload(overrides: Partial<NotificationPayload> = {}): NotificationPayload {
  return {
    leadId: "lead-1",
    priority: "urgent",
    leadType: "residential",
    customerName: "Jane Doe",
    customerPhone: "+15551234567",
    address: "123 Main St, Chicago, IL",
    problemSummary: "Water heater leaking",
    transcriptLink: null,
    ...overrides,
  };
}

describe("renderSms", () => {
  it("includes every field and the CLAIM instruction", () => {
    const text = renderSms(basePayload());

    expect(text).toContain("Jane Doe");
    expect(text).toContain("+15551234567");
    expect(text).toContain("Water heater leaking");
    expect(text).toContain("URGENT");
    expect(text).toContain("Reply CLAIM to take this lead.");
  });

  it("includes the transcript link when present", () => {
    const text = renderSms(basePayload({ transcriptLink: "https://app.example.com/calls/1" }));

    expect(text).toContain("https://app.example.com/calls/1");
  });

  it("truncates an overlong problem summary to stay within the 1600-char SMS limit", () => {
    const text = renderSms(basePayload({ problemSummary: "x".repeat(2000) }));

    expect(text.length).toBeLessThanOrEqual(1600);
    expect(text).toContain("…");
  });
});

describe("renderEmail", () => {
  it("produces an HTML table with every field, HTML-escaped", () => {
    const { subject, html } = renderEmail(basePayload({ customerName: "Jane <Doe>" }));

    expect(subject).toContain("URGENT");
    expect(html).toContain("Jane &lt;Doe&gt;");
    expect(html).not.toContain("<Doe>");
  });
});

describe("renderChatMessage", () => {
  it("returns a plain-text block for Slack/Teams", () => {
    const message = renderChatMessage(basePayload());

    expect(message.text).toContain("Jane Doe");
    expect(message.text).toContain("Reply CLAIM to take this lead.");
  });
});

describe("renderGenericWebhook", () => {
  it("returns the payload unchanged — the canonical data model itself", () => {
    const payload = basePayload();

    expect(renderGenericWebhook(payload)).toBe(payload);
  });
});
