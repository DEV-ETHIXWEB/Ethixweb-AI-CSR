import { UnconfiguredEmailSender } from "./unconfigured-email.sender";

describe("UnconfiguredEmailSender", () => {
  it("returns an honest failure result rather than pretending to send", async () => {
    const sender = new UnconfiguredEmailSender();

    const result = await sender.send(
      { email: "someone@example.com" },
      {
        leadId: "lead-1",
        priority: "routine",
        leadType: "residential",
        customerName: "Jane",
        customerPhone: "+15551234567",
        address: "123 Main St",
        problemSummary: "Leaky faucet",
        transcriptLink: null,
      },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("not");
  });
});
