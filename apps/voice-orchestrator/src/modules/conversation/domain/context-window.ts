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

/**
 * 2026-10-22, chasing a second tester's "extremely long pauses" near the end
 * of a call: the MESSAGE COUNT is bounded, and the summary's own LENGTH was
 * not. Each pass carries the previous summary forward verbatim and appends
 * twenty more lines to it, so on the real 21-minute, 99-turn call this
 * module's own comment describes, the summary alone had grown to hold some
 * eighty messages of text. Every later turn then paid for all of it, in
 * tokens and in time to first word, on exactly the calls that were already
 * dragging.
 *
 * Kept as a CHARACTER budget on the carried-forward half, with the newest
 * lines kept and the oldest dropped: the oldest material is both the least
 * likely to still matter and the most likely to have been restated since
 * (the call notes put the name, address, ZIP and number in front of every
 * turn regardless, which is what makes losing the tail of a long summary
 * survivable at all). 4000 characters is roughly a thousand tokens -- room
 * for a long call's worth of facts, and a firm ceiling on a pathological one.
 */
const MAX_CARRIED_SUMMARY_CHARS = 4000;
const SUMMARY_TRUNCATION_MARKER = "[...earlier detail dropped to stay within the window] ";

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
      capSummaryLength(lines.join(" | ")),
  };

  return [summary, ...kept];
}

/**
 * Trims a summary to MAX_CARRIED_SUMMARY_CHARS, keeping the NEWEST lines and
 * cutting at a line boundary so no fact is left as half a sentence.
 */
function capSummaryLength(body: string): string {
  if (body.length <= MAX_CARRIED_SUMMARY_CHARS) {
    return body;
  }
  const tail = body.slice(body.length - MAX_CARRIED_SUMMARY_CHARS);
  const firstBoundary = tail.indexOf(" | ");
  const fromBoundary = firstBoundary === -1 ? tail : tail.slice(firstBoundary + 3);
  return `${SUMMARY_TRUNCATION_MARKER}${fromBoundary}`;
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
