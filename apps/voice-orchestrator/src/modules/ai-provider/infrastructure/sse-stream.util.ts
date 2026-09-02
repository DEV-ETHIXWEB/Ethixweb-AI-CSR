/**
 * Provider-agnostic Server-Sent-Events framer: reads a fetch `Response`
 * body stream and yields each event's raw `data:` payload as a string,
 * buffering on the standard SSE `\n\n` event boundary and joining
 * multi-line `data:` fields per the SSE spec. Every one of OpenAI's,
 * Anthropic's, and Gemini's (`alt=sse`) streaming APIs use this same outer
 * framing — only the JSON payload *inside* each `data:` line differs,
 * which is each adapter's own concern, not this util's.
 */
export async function* readSseEvents(response: Response): AsyncGenerator<string> {
  const body = response.body;
  if (!body) {
    return;
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const result = (await reader.read()) as { done: boolean; value: Uint8Array | undefined };
      if (result.done || !result.value) {
        break;
      }
      buffer += decoder.decode(result.value, { stream: true });

      for (;;) {
        const boundary = findEventBoundary(buffer);
        if (boundary === null) {
          break;
        }
        const rawEvent = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary.length);
        const payload = extractDataPayload(rawEvent);
        if (payload !== null) {
          yield payload;
        }
      }
    }
    const trailing = extractDataPayload(buffer);
    if (trailing !== null) {
      yield trailing;
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * The earliest blank line in the buffer, in any of the three line-ending
 * forms the SSE spec permits (LF, CRLF, or bare CR). Returns its offset and
 * how many characters to skip: CRLFCRLF is four characters where LFLF is
 * two, and slicing a fixed 2 would leave a stray CRLF at the head of the
 * next event.
 */
function findEventBoundary(buffer: string): { index: number; length: number } | null {
  let best: { index: number; length: number } | null = null;
  for (const separator of ["\r\n\r\n", "\n\n", "\r\r"]) {
    const index = buffer.indexOf(separator);
    if (index === -1) {
      continue;
    }
    // On a tie the longest separator wins: at one offset both CRLFCRLF and
    // CRCR can appear to match, and consuming only two characters there
    // would cut the boundary in half.
    const better =
      best === null ||
      index < best.index ||
      (index === best.index && separator.length > best.length);
    if (better) {
      best = { index, length: separator.length };
    }
  }
  return best;
}

function extractDataPayload(rawEvent: string): string | null {
  const dataLines = rawEvent
    .split(/\r\n|\n|\r/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trimStart());
  if (dataLines.length === 0) {
    return null;
  }
  return dataLines.join("\n");
}
