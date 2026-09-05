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

  /**
   * Found live on a real ~21-minute, 99-turn call: repeated compaction
   * (this fires every ~20 new messages past the first pass, not once, on
   * a call this long) used to silently drop an EARLIER summary's content
   * the moment that summary itself aged out of the most-recent-20 window
   * — because the old code only folded "user"/"assistant" messages into
   * a new summary, and a prior summary is role "system". Confirmed root
   * cause of a real memory failure: the caller gave their name once
   * early on; ~57 turns and multiple compaction passes later, Grace
   * asked them to repeat it. This reproduces that exact shape —
   * compaction fired twice, like it would over a real long call — and
   * proves the early fact survives both passes.
   */
  it("survives a SECOND compaction pass — an earlier pass's own summary is folded forward, not silently dropped", () => {
    let messages: AiMessage[] = [
      { role: "user", content: "hi it's Akash Kumar calling about a leak" },
      { role: "assistant", content: "Got it, Akash Kumar. What's going on?" },
      ...userMessages(DEFAULT_MAX_MESSAGES),
    ];

    // First pass: the name-bearing turn gets folded into a summary.
    messages = compressMessages(messages);
    const afterFirstPass = messages[0]?.content ?? "";
    expect(afterFirstPass).toContain("Akash Kumar");

    // Simulate the rest of a long call: enough more turns for the
    // message count to cross the threshold a SECOND time — the exact
    // shape `runTurn` produces, calling compressMessages again on every
    // turn as messages keep accumulating.
    messages = [...messages, ...userMessages(DEFAULT_MAX_MESSAGES)];
    messages = compressMessages(messages);

    const afterSecondPass = messages[0]?.content ?? "";
    expect(messages[0]?.role).toBe("system");
    expect(afterSecondPass).toContain("Akash Kumar");
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
