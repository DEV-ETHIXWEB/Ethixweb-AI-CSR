import type { AiMessage } from "../../ai-provider/domain/ai-provider.port";
import { compressMessages, DEFAULT_MAX_MESSAGES } from "./context-window";

function userMessages(count: number): AiMessage[] {
  return Array.from({ length: count }, (_unused, index) => ({
    role: "user" as const,
    content: `message ${index}`,
  }));
}

describe("compressMessages", () => {
  it("returns the list untouched when it's within the limit", () => {
    const messages = userMessages(10);

    expect(compressMessages(messages)).toBe(messages);
  });

  it("compresses older messages into a single summary once over the limit", () => {
    const messages = userMessages(DEFAULT_MAX_MESSAGES + 10);

    const result = compressMessages(messages);

    expect(result.length).toBeLessThan(messages.length);
    expect(result[0]?.role).toBe("system");
    expect(result[0]?.content).toContain("summarized to stay within the context window");
  });

  it("keeps the most recent messages verbatim", () => {
    const messages = userMessages(DEFAULT_MAX_MESSAGES + 10);

    const result = compressMessages(messages);

    const lastOriginal = messages[messages.length - 1];
    expect(result[result.length - 1]).toEqual(lastOriginal);
  });

  it("never leaves a tool result orphaned from the assistant message that requested it", () => {
    // Build a history whose naive cut point would land exactly on a
    // `tool` message, orphaning it from its assistant tool_call.
    const messages: AiMessage[] = [
      ...userMessages(DEFAULT_MAX_MESSAGES),
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "call-1", name: "searchCustomer", arguments: {} }],
      },
      ...Array.from({ length: 19 }, () => ({
        role: "tool" as const,
        toolCallId: "call-1",
        content: "{}",
      })),
    ];

    const result = compressMessages(messages);

    const firstNonSummary = result.find((message) => message.role !== "system");
    expect(firstNonSummary?.role).not.toBe("tool");
  });
});
