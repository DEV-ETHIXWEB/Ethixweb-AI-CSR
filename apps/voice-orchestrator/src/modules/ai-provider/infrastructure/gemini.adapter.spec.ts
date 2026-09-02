import type { AiCompletionChunk, AiCompletionRequest, AiMessage } from "../domain/ai-provider.port";
import { GeminiAdapter } from "./gemini.adapter";

function sseResponse(status: number, body: string): Response {
  return new Response(body, { status });
}

async function collect(chunks: AsyncIterable<AiCompletionChunk>): Promise<AiCompletionChunk[]> {
  const result: AiCompletionChunk[] = [];
  for await (const chunk of chunks) {
    result.push(chunk);
  }
  return result;
}

function baseRequest(
  messages: AiMessage[] = [{ role: "user", content: "hi" }],
): AiCompletionRequest {
  return { model: "gemini-2.5-pro", systemPrompt: "You are a CSR.", messages };
}

describe("GeminiAdapter", () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });

  it("streams text parts and terminates with stopReason end_turn on finishReason STOP", async () => {
    const body =
      'data: {"candidates":[{"content":{"parts":[{"text":"Hello"}]}}]}\n\n' +
      'data: {"candidates":[{"content":{"parts":[{"text":" there"}]},"finishReason":"STOP"}]}\n\n';
    fetchMock.mockResolvedValueOnce(sseResponse(200, body));
    const adapter = new GeminiAdapter("test-key");

    const chunks = await collect(adapter.streamCompletion(baseRequest()));

    expect(chunks).toEqual([
      { type: "text_delta", text: "Hello" },
      { type: "text_delta", text: " there" },
      { type: "done", stopReason: "end_turn" },
    ]);
  });

  it("maps a functionCall part to a tool_call chunk with stopReason tool_use", async () => {
    const body =
      'data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"searchCustomer","args":{"phone":"+15551234567"}}}]},"finishReason":"STOP"}]}\n\n';
    fetchMock.mockResolvedValueOnce(sseResponse(200, body));
    const adapter = new GeminiAdapter("test-key");

    const chunks = await collect(adapter.streamCompletion(baseRequest()));

    expect(chunks[0]).toMatchObject({
      type: "tool_call",
      toolCall: { name: "searchCustomer", arguments: { phone: "+15551234567" } },
    });
    expect(chunks[1]).toEqual({ type: "done", stopReason: "tool_use" });
  });

  it("recovers the function name for a tool-result message by scanning back to the matching assistant toolCalls entry", async () => {
    fetchMock.mockResolvedValueOnce(sseResponse(200, ""));
    const adapter = new GeminiAdapter("test-key");
    const messages: AiMessage[] = [
      { role: "user", content: "what's the status" },
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "call-1", name: "searchCustomer", arguments: { phone: "+1555" } }],
      },
      { role: "tool", toolCallId: "call-1", content: '{"found":true}' },
    ];

    await collect(adapter.streamCompletion(baseRequest(messages)));

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const sentBody = JSON.parse(init.body as string) as {
      contents: Array<{ role: string; parts: Array<{ functionResponse?: { name: string } }> }>;
    };
    expect(sentBody.contents[2]?.parts[0]?.functionResponse?.name).toBe("searchCustomer");
  });

  it("yields a retryable error chunk on a 503 response", async () => {
    fetchMock.mockResolvedValueOnce(sseResponse(503, "unavailable"));
    const adapter = new GeminiAdapter("test-key");

    const chunks = await collect(adapter.streamCompletion(baseRequest()));

    expect(chunks).toEqual([{ type: "error", message: expect.any(String), retryable: true }]);
  });
  it("translates JSON Schema `const` into a single-value enum and drops keywords Gemini rejects", async () => {
    // Regression: Gemini 400s the ENTIRE request on an unsupported schema
    // keyword, so the tool catalog's `source: { const: "ai_csr" }` took down
    // every turn rather than degrading. Observed live, not hypothesized.
    fetchMock.mockResolvedValueOnce(
      sseResponse(200, 'data: {"candidates":[{"content":{"parts":[{"text":"ok"}]},"finishReason":"STOP"}]}\n\n'),
    );
    const adapter = new GeminiAdapter("test-key");

    await collect(
      adapter.streamCompletion({
        ...baseRequest(),
        tools: [
          {
            name: "createCustomer",
            description: "Creates a customer",
            parameters: {
              type: "object",
              additionalProperties: false,
              properties: {
                source: { type: "string", const: "ai_csr" },
                tags: { type: "array", items: { type: "string", const: "x" } },
                nested: {
                  type: "object",
                  properties: { deep: { type: "string", const: "y" } },
                },
                priority: { type: "string", const: "high", enum: ["high", "low"] },
              },
              required: ["source"],
            },
          },
        ],
      }),
    );

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    const properties = body.tools[0].functionDeclarations[0].parameters.properties;

    expect(properties.source).toEqual({ type: "string", enum: ["ai_csr"] });
    expect(properties.tags.items).toEqual({ type: "string", enum: ["x"] });
    expect(properties.nested.properties.deep).toEqual({ type: "string", enum: ["y"] });
    // An explicit enum already states the constraint; `const` must not clobber it.
    expect(properties.priority).toEqual({ type: "string", enum: ["high", "low"] });
    expect(body.tools[0].functionDeclarations[0].parameters.additionalProperties).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('"const"');
  });
});
