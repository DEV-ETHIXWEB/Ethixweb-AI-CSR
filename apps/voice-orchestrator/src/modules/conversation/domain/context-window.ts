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
 *
 * Found live on a real ~21-minute, 99-turn call: this fires repeatedly
 * over a call that long (every ~20 new messages past the first
 * compaction, not once), and each pass used to build its summary ONLY
 * from `dropped` messages with role "user"/"assistant" — silently
 * excluding a role "system" message, which is exactly what an EARLIER
 * compaction's own summary is. The second (or third, ...) compaction
 * pass permanently discarded the first pass's entire summary content —
 * including the caller's own name, given clearly early in the call — the
 * moment that summary itself aged out of the most-recent-20 window.
 * Confirmed as the root cause of a real memory failure: the caller gave
 * their full name once, ~57 turns and several compaction passes later
 * Grace asked them to repeat it. A prior summary is carried forward
 * verbatim now (self-describing already, so it needs no `role:` prefix,
 * unlike a plain user/assistant line) instead of being filtered out.
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

  const lines = dropped
    .map((message) => {
      if (message.role === "system") {
        // An earlier compaction pass's own summary — already
        // self-describing (carries its own "[Earlier in this call...]"
        // prefix), so it's carried forward as-is, not re-labeled.
        return message.content;
      }
      if (message.role === "user" || message.role === "assistant") {
        return `${message.role}: ${message.content}`;
      }
      // "tool" role (a tool call's raw result payload): deliberately
      // still excluded, same as before this fix — the fact a tool was
      // called and what it returned isn't the kind of fact a caller
      // needs remembered back to them, unlike what they themselves said.
      return "";
    })
    .filter((line) => line.trim().length > 0);

  const summary: AiMessage = {
    role: "system",
    content:
      `[Earlier in this call — ${dropped.length} message(s) summarized to stay within the context window] ` +
      lines.join(" | "),
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
