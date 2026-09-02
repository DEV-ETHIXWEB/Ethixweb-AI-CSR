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
    const sentBody = JSON.parse(init.body as string) as {
      system: Array<{ type: string; text: string }>;
      messages: Array<{ role: string; content: Array<{ type: string; text: string }> }>;
    };
    expect(sentBody.system[0]?.text).toBe("You are a CSR.");
    expect(sentBody.messages).toEqual([
      { role: "user", content: [expect.objectContaining({ type: "text", text: "hi" })] },
    ]);
  });

  /**
   * Regression coverage for a real cost-optimization finding: docs/03 §1
   * itself documents that the system prompt is assembled once per call
   * specifically so provider-side caching is effective, but no
   * `cache_control` breakpoint was ever actually set — every turn re-billed
   * the full prefix at full price instead of the ~0.1x cached rate. Two
   * breakpoints are the correct shape for a multi-turn call: one on the
   * static system+tools prefix, one on the growing message tail so the
   * NEXT turn's identical history hits cache too.
   */
  describe("prompt caching (cost optimization)", () => {
    it("marks the system prompt with an ephemeral cache breakpoint", async () => {
      fetchMock.mockResolvedValueOnce(sseResponse(200, ""));
      const adapter = new AnthropicAdapter("test-key");

      await collect(adapter.streamCompletion(baseRequest()));

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const sentBody = JSON.parse(init.body as string) as {
        system: Array<{ cache_control?: { type: string } }>;
      };
      expect(sentBody.system[0]?.cache_control).toEqual({ type: "ephemeral" });
    });

    it("marks only the LAST message's LAST content block with a cache breakpoint, not every message", async () => {
      fetchMock.mockResolvedValueOnce(sseResponse(200, ""));
      const adapter = new AnthropicAdapter("test-key");
      const request: AiCompletionRequest = {
        ...baseRequest(),
        messages: [
          { role: "user", content: "first turn" },
          { role: "assistant", content: "first reply" },
          { role: "user", content: "second turn" },
        ],
      };

      await collect(adapter.streamCompletion(request));

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const sentBody = JSON.parse(init.body as string) as {
        messages: Array<{ content: Array<{ cache_control?: { type: string } }> }>;
      };
      expect(sentBody.messages[0]?.content[0]?.cache_control).toBeUndefined();
      expect(sentBody.messages[1]?.content[0]?.cache_control).toBeUndefined();
      expect(sentBody.messages[2]?.content[0]?.cache_control).toEqual({ type: "ephemeral" });
    });

    it("does not crash when messages is empty (the very first request has no prior history)", async () => {
      fetchMock.mockResolvedValueOnce(sseResponse(200, ""));
      const adapter = new AnthropicAdapter("test-key");
      const request: AiCompletionRequest = { ...baseRequest(), messages: [] };

      await expect(collect(adapter.streamCompletion(request))).resolves.toEqual([]);

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const sentBody = JSON.parse(init.body as string) as { messages: unknown[] };
      expect(sentBody.messages).toEqual([]);
    });

    it("marks the cache breakpoint on a tool_result message when it is the last message (barge-in mid-tool-loop)", async () => {
      fetchMock.mockResolvedValueOnce(sseResponse(200, ""));
      const adapter = new AnthropicAdapter("test-key");
      const request: AiCompletionRequest = {
        ...baseRequest(),
        messages: [
          { role: "user", content: "search for jane" },
          { role: "tool", content: '{"found":true}', toolCallId: "toolu_1" },
        ],
      };

      await collect(adapter.streamCompletion(request));

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const sentBody = JSON.parse(init.body as string) as {
        messages: Array<{ content: Array<{ cache_control?: { type: string } }> }>;
      };
      expect(sentBody.messages[1]?.content[0]?.cache_control).toEqual({ type: "ephemeral" });
    });
  });
});
