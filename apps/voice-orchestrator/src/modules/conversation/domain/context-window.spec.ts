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

  /**
   * H2: `dropped.map(...)` only ever reads `message.content` for a
   * user/assistant line — never `message.toolCalls` — so a tool call's
   * own arguments (which can carry a caller's phone number, address, or
   * other sensitive payload) structurally cannot appear in the compacted
   * summary text even when the ASSISTANT message that requested it is
   * itself kept in the fold (only role "tool" — the raw result — is
   * dropped outright; the requesting assistant message's `content`, not
   * its `toolCalls`, is what gets folded in). Explicit regression for the
   * H2 mission requirement that no raw sensitive payload leaks into a
   * durable, potentially-logged summary string.
   */
  it("never leaks a tool call's own structured arguments (a caller's phone number, address, etc.) into the compacted summary — only what the caller/agent actually SAID in plain text is preserved", () => {
    // Deliberately NOT spoken aloud in any user/assistant text — this
    // models the realistic case where the caller gave these details over
    // several EARLIER turns (already summarized away) and the model is
    // now just submitting the structured record silently, with no new
    // narration of its own that turn (`content: ""`, tool calls only).
    const sensitivePhone = "555-201-4477";
    const sensitiveAddress = "742 Evergreen Terrace";
    const messages: AiMessage[] = [
      { role: "user", content: "go ahead and submit that" },
      {
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "call-1",
            name: "createCustomer",
            arguments: {
              name: { first: "Jordan", last: "Ellis" },
              phone: sensitivePhone,
              address: { street: sensitiveAddress },
              source: "ai_csr",
            },
          },
        ],
      },
      { role: "tool", toolCallId: "call-1", content: JSON.stringify({ customer_id: "cust-1" }) },
      { role: "assistant", content: "Got it, you're all set." },
      ...userMessages(DEFAULT_MAX_MESSAGES),
    ];

    const result = compressMessages(messages);

    const summary = result[0]?.content ?? "";
    expect(result[0]?.role).toBe("system");
    expect(summary).not.toContain(sensitivePhone);
    expect(summary).not.toContain(sensitiveAddress);
    expect(summary).not.toContain("cust-1");
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
