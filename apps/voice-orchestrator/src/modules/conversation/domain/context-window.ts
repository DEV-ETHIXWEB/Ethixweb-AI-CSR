import type { AiMessage } from "../../ai-provider/domain/ai-provider.port";

/**
 * Context Manager / memory limits / compression. A CALL, not a chat
 * session: docs/09-cost-analysis.md's own model assumes a handful of
 * minutes per call, so the message list is bounded in practice — this is
 * a safety valve against a pathologically long call (or a model stuck in
 * a tool loop), not a routine compaction path.
 *
 * Compression strategy is deliberately the simplest thing that preserves
 * correctness: keep the most recent N messages verbatim, and replace
 * anything older with a single synthetic summary message. Crucially it
 * never splits an assistant tool_call from its matching tool result —
 * every provider adapter rejects an orphaned tool result, so the cut point
 * is always moved backward to a clean boundary rather than mid-exchange.
 */
export const DEFAULT_MAX_MESSAGES = 40;
const RECENT_KEEP = 20;

export function compressMessages(
  messages: AiMessage[],
  maxMessages: number = DEFAULT_MAX_MESSAGES,
): AiMessage[] {
  if (messages.length <= maxMessages) {
    return messages;
  }

  const cutIndex = findSafeCutIndex(messages, Math.max(0, messages.length - RECENT_KEEP));
  const dropped = messages.slice(0, cutIndex);
  const kept = messages.slice(cutIndex);

  if (dropped.length === 0) {
    return messages;
  }

  const summary: AiMessage = {
    role: "system",
    content:
      `[Earlier in this call — ${dropped.length} message(s) summarized to stay within the context window] ` +
      dropped
        .filter((message) => message.role === "user" || message.role === "assistant")
        .map((message) => `${message.role}: ${message.content}`)
        .filter((line) => line.trim().length > 0)
        .join(" | "),
  };

  return [summary, ...kept];
}

/**
 * Walks the proposed cut point backward until it lands somewhere that
 * doesn't orphan a tool result from the assistant message that requested
 * it — the one invariant every provider's message format enforces.
 */
function findSafeCutIndex(messages: AiMessage[], proposed: number): number {
  let index = proposed;
  while (index > 0 && index < messages.length && messages[index]?.role === "tool") {
    index -= 1;
  }
  return index;
}
