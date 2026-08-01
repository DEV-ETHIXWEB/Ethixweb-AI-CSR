import type { AiCompletionChunk, AiCompletionRequest } from "../domain/ai-provider.port";
import { OpenAiAdapter } from "./openai.adapter";

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

function baseRequest(): AiCompletionRequest {
  return {
    model: "gpt-4o",
    systemPrompt: "You are a CSR.",
    messages: [{ role: "user", content: "hi" }],
  };
}

describe("OpenAiAdapter", () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });

  it("streams text deltas and terminates with stopReason end_turn on finish_reason stop", async () => {
    const body =
      'data: {"choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}\n\n' +
      'data: {"choices":[{"delta":{"content":" there"},"finish_reason":null}]}\n\n' +
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n' +
      "data: [DONE]\n\n";
    fetchMock.mockResolvedValueOnce(sseResponse(200, body));
    const adapter = new OpenAiAdapter("test-key");

    const chunks = await collect(adapter.streamCompletion(baseRequest()));

    expect(chunks).toEqual([
      { type: "text_delta", text: "Hello" },
      { type: "text_delta", text: " there" },
      { type: "done", stopReason: "end_turn" },
    ]);
  });

  it("accumulates streamed tool_call argument fragments into one complete tool_call chunk", async () => {
    const body =
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"searchCustomer","arguments":""}}]},"finish_reason":null}]}\n\n' +
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"phone\\":"}}]},"finish_reason":null}]}\n\n' +
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"+15551234567\\"}"}}]},"finish_reason":null}]}\n\n' +
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n' +
      "data: [DONE]\n\n";
    fetchMock.mockResolvedValueOnce(sseResponse(200, body));
    const adapter = new OpenAiAdapter("test-key");

    const chunks = await collect(adapter.streamCompletion(baseRequest()));

    expect(chunks).toEqual([
      {
        type: "tool_call",
        toolCall: { id: "call_1", name: "searchCustomer", arguments: { phone: "+15551234567" } },
      },
      { type: "done", stopReason: "tool_use" },
    ]);
  });

  it("yields a retryable error chunk on a 429 response instead of throwing", async () => {
    fetchMock.mockResolvedValueOnce(sseResponse(429, "rate limited"));
    const adapter = new OpenAiAdapter("test-key");

    const chunks = await collect(adapter.streamCompletion(baseRequest()));

    expect(chunks).toEqual([{ type: "error", message: expect.any(String), retryable: true }]);
  });

  it("yields a non-retryable error chunk on a 401 response", async () => {
    fetchMock.mockResolvedValueOnce(sseResponse(401, "invalid key"));
    const adapter = new OpenAiAdapter("test-key");

    const chunks = await collect(adapter.streamCompletion(baseRequest()));

    expect(chunks).toEqual([{ type: "error", message: expect.any(String), retryable: false }]);
  });

  it("sends the system prompt as the first message and includes tool schemas when provided", async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse(
        200,
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
      ),
    );
    const adapter = new OpenAiAdapter("test-key");
    const request: AiCompletionRequest = {
      ...baseRequest(),
      tools: [
        {
          name: "searchCustomer",
          description: "look up a customer",
          parameters: { type: "object" },
        },
      ],
    };

    await collect(adapter.streamCompletion(request));

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const sentBody = JSON.parse(init.body as string) as {
      messages: Array<{ role: string; content: string }>;
      tools: Array<{ function: { name: string } }>;
    };
    expect(sentBody.messages[0]).toEqual({ role: "system", content: "You are a CSR." });
    expect(sentBody.tools[0]?.function.name).toBe("searchCustomer");
  });
});
