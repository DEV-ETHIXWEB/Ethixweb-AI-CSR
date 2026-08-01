import type { AiCompletionChunk, AiCompletionRequest } from "../domain/ai-provider.port";
import { AnthropicAdapter } from "./anthropic.adapter";

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
    model: "claude-sonnet-5",
    systemPrompt: "You are a CSR.",
    messages: [{ role: "user", content: "hi" }],
  };
}

describe("AnthropicAdapter", () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });

  it("streams text_delta events and terminates on message_delta stop_reason end_turn", async () => {
    const body =
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text"}}\n\n' +
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}\n\n' +
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" there"}}\n\n' +
      'data: {"type":"content_block_stop","index":0}\n\n' +
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n';
    fetchMock.mockResolvedValueOnce(sseResponse(200, body));
    const adapter = new AnthropicAdapter("test-key");

    const chunks = await collect(adapter.streamCompletion(baseRequest()));

    expect(chunks).toEqual([
      { type: "text_delta", text: "Hello" },
      { type: "text_delta", text: " there" },
      { type: "done", stopReason: "end_turn" },
    ]);
  });

  it("assembles a tool_use content block's input_json_delta fragments into one tool_call chunk", async () => {
    const body =
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"searchCustomer"}}\n\n' +
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"phone\\":"}}\n\n' +
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"\\"+15551234567\\"}"}}\n\n' +
      'data: {"type":"content_block_stop","index":0}\n\n' +
      'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"}}\n\n';
    fetchMock.mockResolvedValueOnce(sseResponse(200, body));
    const adapter = new AnthropicAdapter("test-key");

    const chunks = await collect(adapter.streamCompletion(baseRequest()));

    expect(chunks).toEqual([
      {
        type: "tool_call",
        toolCall: { id: "toolu_1", name: "searchCustomer", arguments: { phone: "+15551234567" } },
      },
      { type: "done", stopReason: "tool_use" },
    ]);
  });

  it("yields a retryable error chunk on a 529 (overloaded) response", async () => {
    fetchMock.mockResolvedValueOnce(sseResponse(529, "overloaded"));
    const adapter = new AnthropicAdapter("test-key");

    const chunks = await collect(adapter.streamCompletion(baseRequest()));

    expect(chunks).toEqual([{ type: "error", message: expect.any(String), retryable: true }]);
  });

  it("sends the system prompt as a top-level field, not a message", async () => {
    fetchMock.mockResolvedValueOnce(sseResponse(200, ""));
    const adapter = new AnthropicAdapter("test-key");

    await collect(adapter.streamCompletion(baseRequest()));

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const sentBody = JSON.parse(init.body as string) as { system: string; messages: unknown[] };
    expect(sentBody.system).toBe("You are a CSR.");
    expect(sentBody.messages).toEqual([{ role: "user", content: "hi" }]);
  });
});
