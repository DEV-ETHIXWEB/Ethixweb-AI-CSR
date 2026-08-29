import { CircuitBreakerRegistry } from "@ethixweb/shared-kernel";
import type {
  AiCompletionChunk,
  AiCompletionRequest,
  AiProviderPort,
} from "../domain/ai-provider.port";
import { FallbackAiProvider } from "./fallback-ai-provider";

function baseRequest(): AiCompletionRequest {
  return { model: "any", systemPrompt: "sys", messages: [{ role: "user", content: "hi" }] };
}

async function collect(chunks: AsyncIterable<AiCompletionChunk>): Promise<AiCompletionChunk[]> {
  const result: AiCompletionChunk[] = [];
  for await (const chunk of chunks) {
    result.push(chunk);
  }
  return result;
}

function fakeProvider(
  name: string,
  chunks: AiCompletionChunk[],
  onSignal?: (signal: AbortSignal | undefined) => void,
): AiProviderPort {
  return {
    providerName: name,
    async *streamCompletion(_request, signal) {
      onSignal?.(signal);
      for (const chunk of chunks) {
        yield chunk;
      }
    },
  };
}

describe("FallbackAiProvider", () => {
  it("returns the primary provider's stream when it succeeds", async () => {
    const primary = fakeProvider("openai", [
      { type: "text_delta", text: "hi" },
      { type: "done", stopReason: "end_turn" },
    ]);
    const secondary = fakeProvider("anthropic", [{ type: "text_delta", text: "never used" }]);
    const router = new FallbackAiProvider([primary, secondary], new CircuitBreakerRegistry());

    const chunks = await collect(router.streamCompletion(baseRequest()));

    expect(chunks).toEqual([
      { type: "text_delta", text: "hi" },
      { type: "done", stopReason: "end_turn" },
    ]);
  });

  it("falls over to the next provider when the primary's first chunk is a retryable error", async () => {
    const primary = fakeProvider("openai", [
      { type: "error", message: "rate limited", retryable: true },
    ]);
    const secondary = fakeProvider("anthropic", [
      { type: "text_delta", text: "from anthropic" },
      { type: "done", stopReason: "end_turn" },
    ]);
    const router = new FallbackAiProvider([primary, secondary], new CircuitBreakerRegistry());

    const chunks = await collect(router.streamCompletion(baseRequest()));

    expect(chunks).toEqual([
      { type: "text_delta", text: "from anthropic" },
      { type: "done", stopReason: "end_turn" },
    ]);
  });

  it("does NOT fail over once content has already started streaming from a provider", async () => {
    const primary = fakeProvider("openai", [
      { type: "text_delta", text: "partial" },
      { type: "error", message: "connection dropped mid-stream", retryable: true },
    ]);
    const secondary = fakeProvider("anthropic", [
      { type: "text_delta", text: "should not appear" },
    ]);
    const router = new FallbackAiProvider([primary, secondary], new CircuitBreakerRegistry());

    const chunks = await collect(router.streamCompletion(baseRequest()));

    expect(chunks).toEqual([
      { type: "text_delta", text: "partial" },
      { type: "error", message: "connection dropped mid-stream", retryable: true },
    ]);
  });

  it("surfaces a non-retryable error from the primary immediately, without trying the next provider", async () => {
    const primary = fakeProvider("openai", [
      { type: "error", message: "bad api key", retryable: false },
    ]);
    const secondary = fakeProvider("anthropic", [
      { type: "text_delta", text: "should not appear" },
    ]);
    const router = new FallbackAiProvider([primary, secondary], new CircuitBreakerRegistry());

    const chunks = await collect(router.streamCompletion(baseRequest()));

    expect(chunks).toEqual([{ type: "error", message: "bad api key", retryable: false }]);
  });

  it("yields a final error chunk when every configured provider fails", async () => {
    const primary = fakeProvider("openai", [{ type: "error", message: "down", retryable: true }]);
    const secondary = fakeProvider("anthropic", [
      { type: "error", message: "also down", retryable: true },
    ]);
    const router = new FallbackAiProvider([primary, secondary], new CircuitBreakerRegistry());

    const chunks = await collect(router.streamCompletion(baseRequest()));

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ type: "error", retryable: false });
  });

  it("skips a provider whose circuit breaker is already open", async () => {
    const registry = new CircuitBreakerRegistry({ failureThreshold: 1 });
    const primary = fakeProvider("openai", [{ type: "error", message: "down", retryable: true }]);
    const secondary = fakeProvider("anthropic", [
      { type: "text_delta", text: "from anthropic" },
      { type: "done", stopReason: "end_turn" },
    ]);
    const router = new FallbackAiProvider([primary, secondary], registry);
    // First call trips openai's breaker open (failureThreshold: 1).
    await collect(router.streamCompletion(baseRequest()));

    const chunks = await collect(router.streamCompletion(baseRequest()));

    expect(chunks).toEqual([
      { type: "text_delta", text: "from anthropic" },
      { type: "done", stopReason: "end_turn" },
    ]);
  });

  /**
   * Regression coverage for a real bug found live: none of the three
   * provider adapters bound their own fetch() call, and the only
   * AbortSignal a real turn ever supplies is barge-in interrupt, which is
   * undefined on an ordinary turn. Traced live: a hung (not erroring, not
   * unreachable, genuinely hung) LLM vendor connection would leave a real
   * caller in dead air for the rest of the call, nothing anywhere on this
   * path would ever time out. Fixed by combining the caller's own signal
   * with an internal AbortSignal.timeout() before it ever reaches a
   * provider. The actual 15s firing itself isn't asserted here (Jest's
   * fake timers don't intercept AbortSignal.timeout's own native timer,
   * confirmed directly, and a real 15s wait doesn't belong in this suite),
   * that's standard, already-proven platform behavior; what these tests
   * cover is the part that's actually this class's own logic: a bounding
   * signal is always installed, and it still correctly reflects the
   * caller's own interrupt signal exactly as before.
   */
  it("always passes a defined AbortSignal to the provider, even when the caller supplies none, so a hung vendor call is never left completely unbounded", async () => {
    let observedSignal: AbortSignal | undefined;
    const primary = fakeProvider("openai", [{ type: "done", stopReason: "end_turn" }], (signal) => {
      observedSignal = signal;
    });
    const router = new FallbackAiProvider([primary], new CircuitBreakerRegistry());

    await collect(router.streamCompletion(baseRequest()));

    expect(observedSignal).toBeInstanceOf(AbortSignal);
    expect(observedSignal?.aborted).toBe(false);
  });

  it("still aborts the signal reaching the provider when the caller's own interrupt signal fires, preserving barge-in behavior through the new combined signal", async () => {
    const controller = new AbortController();
    let observedSignal: AbortSignal | undefined;
    const primary = fakeProvider("openai", [{ type: "done", stopReason: "end_turn" }], (signal) => {
      observedSignal = signal;
    });
    const router = new FallbackAiProvider([primary], new CircuitBreakerRegistry());

    await collect(router.streamCompletion(baseRequest(), controller.signal));
    expect(observedSignal?.aborted).toBe(false);

    controller.abort();

    expect(observedSignal?.aborted).toBe(true);
  });
});
