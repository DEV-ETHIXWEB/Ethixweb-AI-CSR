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

      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const rawEvent = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const payload = extractDataPayload(rawEvent);
        if (payload !== null) {
          yield payload;
        }
        boundary = buffer.indexOf("\n\n");
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

function extractDataPayload(rawEvent: string): string | null {
  const dataLines = rawEvent
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trimStart());
  if (dataLines.length === 0) {
    return null;
  }
  return dataLines.join("\n");
}
