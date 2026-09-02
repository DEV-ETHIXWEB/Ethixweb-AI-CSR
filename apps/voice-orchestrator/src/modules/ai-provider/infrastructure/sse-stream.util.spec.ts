import { readSseEvents } from "./sse-stream.util";

/**
 * This util is the outer SSE framing shared by every LLM adapter
 * (Anthropic/OpenAI/Gemini) — real, previously-untested parsing logic with
 * no external dependency at all, fully verifiable against a fake
 * `Response`/`ReadableStream` (both real platform globals, not test-only
 * shims) without needing a live provider.
 */
function fakeResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  return new Response(stream);
}

async function collect(response: Response): Promise<string[]> {
  const events: string[] = [];
  for await (const event of readSseEvents(response)) {
    events.push(event);
  }
  return events;
}

describe("readSseEvents", () => {
  it("yields nothing when the response has no body", async () => {
    const response = new Response(null);
    await expect(collect(response)).resolves.toEqual([]);
  });

  it("yields a single event's data payload", async () => {
    const response = fakeResponse(['data: {"foo":1}\n\n']);
    await expect(collect(response)).resolves.toEqual(['{"foo":1}']);
  });

  it("yields multiple events from one chunk, in order", async () => {
    const response = fakeResponse(['data: {"n":1}\n\ndata: {"n":2}\n\ndata: {"n":3}\n\n']);
    await expect(collect(response)).resolves.toEqual(['{"n":1}', '{"n":2}', '{"n":3}']);
  });

  it("reassembles one event whose data: field spans multiple lines by joining them with \\n, per the SSE spec", async () => {
    const response = fakeResponse(["data: line one\ndata: line two\n\n"]);
    await expect(collect(response)).resolves.toEqual(["line one\nline two"]);
  });

  it("assembles an event correctly even when a chunk boundary falls in the middle of it", async () => {
    const response = fakeResponse(['data: {"fo', 'o":1}\n', "\n"]);
    await expect(collect(response)).resolves.toEqual(['{"foo":1}']);
  });

  it("assembles an event correctly even when the chunk boundary splits a multi-byte UTF-8 character", async () => {
    // "café" — the é is a 2-byte UTF-8 sequence; split the bytes mid-character.
    const full = Buffer.from("data: café\n\n", "utf8");
    const splitAt = full.indexOf(0xc3); // first byte of the 2-byte é sequence
    const first = full.subarray(0, splitAt + 1);
    const second = full.subarray(splitAt + 1);

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(first));
        controller.enqueue(new Uint8Array(second));
        controller.close();
      },
    });
    await expect(collect(new Response(stream))).resolves.toEqual(["café"]);
  });

  it("ignores an event block with no data: line (e.g. a bare comment or event: line) rather than yielding an empty string", async () => {
    const response = fakeResponse([": keep-alive comment\n\nevent: ping\n\ndata: real\n\n"]);
    await expect(collect(response)).resolves.toEqual(["real"]);
  });

  it("yields a trailing event that never received a closing blank line (e.g. the final [DONE] chunk)", async () => {
    const response = fakeResponse(['data: {"n":1}\n\ndata: [DONE]']);
    await expect(collect(response)).resolves.toEqual(['{"n":1}', "[DONE]"]);
  });

  it("yields nothing extra when the stream ends cleanly on a blank line, with no trailing partial event", async () => {
    const response = fakeResponse(["data: only\n\n"]);
    await expect(collect(response)).resolves.toEqual(["only"]);
  });

  it("frames CRLF-separated events, the form live Gemini actually sends", async () => {
    // Regression: the framer searched only for LFLF, so a CRLF stream never
    // produced a boundary — every event accumulated and was flushed as one
    // concatenated blob, and each adapter's JSON.parse then failed with
    // "Unexpected non-whitespace character after JSON". Reproduced against
    // live Gemini before this test was written.
    const response = fakeResponse([
      'data: {"n":1}\r\n\r\n',
      'data: {"n":2}\r\n\r\n',
      'data: {"n":3}\r\n\r\n',
    ]);

    const events = await collect(response);

    expect(events).toEqual(['{"n":1}', '{"n":2}', '{"n":3}']);
    events.forEach((event) => expect(() => JSON.parse(event)).not.toThrow());
  });

  it("frames bare-CR events, the third line ending the SSE spec permits", async () => {
    const response = fakeResponse(['data: {"n":1}\r\rdata: {"n":2}\r\r']);

    await expect(collect(response)).resolves.toEqual(['{"n":1}', '{"n":2}']);
  });

  it("leaves no stray CRLF at the head of the event after a CRLF boundary", async () => {
    // CRLFCRLF is four characters; consuming a fixed two left "\r\n" on the
    // next event, whose data line then no longer started with "data:".
    const response = fakeResponse([
      'data: {"first":true}\r\n\r\ndata: {"second":true}\r\n\r\n',
    ]);

    await expect(collect(response)).resolves.toEqual(['{"first":true}', '{"second":true}']);
  });
});
