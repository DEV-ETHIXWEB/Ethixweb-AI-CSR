import type { CircuitBreakerRegistry } from "@ethixweb/shared-kernel";
import type {
  AiCompletionChunk,
  AiCompletionRequest,
  AiProviderPort,
} from "../domain/ai-provider.port";
import { AiProviderHttpError } from "../domain/errors";

/**
 * Fallback Strategy (docs task item 3, "AI Provider Layer"): tries
 * providers in the configured order, one per-provider circuit breaker
 * (shared-kernel's CircuitBreakerRegistry — the same primitive CRM
 * adapters use) so a provider that's currently down is skipped instantly
 * rather than retried on every single turn. Only the FIRST chunk of a
 * stream decides fail-over — once real content has started flowing to
 * the caller, switching providers mid-response would mean either
 * duplicating or losing words the caller may already be hearing (TTS is
 * streamed sentence-by-sentence as it arrives, per docs/02 §3), so a
 * failure after the first chunk is surfaced as-is, not silently retried
 * on a different vendor.
 */
export class FallbackAiProvider implements AiProviderPort {
  readonly providerName = "fallback-router";

  constructor(
    private readonly providers: readonly AiProviderPort[],
    private readonly circuitBreakers: CircuitBreakerRegistry,
  ) {}

  async *streamCompletion(
    request: AiCompletionRequest,
    signal?: AbortSignal,
  ): AsyncIterable<AiCompletionChunk> {
    const attempted: string[] = [];

    for (const provider of this.providers) {
      const breaker = this.circuitBreakers.getOrCreate(provider.providerName);
      attempted.push(provider.providerName);

      let probe: {
        iterator: AsyncIterator<AiCompletionChunk>;
        first: IteratorResult<AiCompletionChunk>;
      };
      try {
        probe = await breaker.execute(() => probeFirstChunk(provider, request, signal));
      } catch {
        continue;
      }

      const { iterator, first } = probe;
      if (first.done) {
        continue;
      }
      yield first.value;
      if (first.value.type === "done" || first.value.type === "error") {
        return;
      }

      for (;;) {
        const next = await iterator.next();
        if (next.done) {
          return;
        }
        yield next.value;
        if (next.value.type === "done" || next.value.type === "error") {
          return;
        }
      }
    }

    yield {
      type: "error",
      message: `All AI providers failed or are unavailable: ${attempted.join(", ")}`,
      retryable: false,
    };
  }
}

async function probeFirstChunk(
  provider: AiProviderPort,
  request: AiCompletionRequest,
  signal?: AbortSignal,
): Promise<{
  iterator: AsyncIterator<AiCompletionChunk>;
  first: IteratorResult<AiCompletionChunk>;
}> {
  const iterator = provider.streamCompletion(request, signal)[Symbol.asyncIterator]();
  const first = await iterator.next();
  // A retryable error on the very first chunk (e.g. 429/5xx before any
  // content streamed) is treated as THIS provider's failure — recorded by
  // the circuit breaker via the throw — so the caller falls through to
  // the next configured provider instead of surfacing it to the caller.
  if (!first.done && first.value.type === "error" && first.value.retryable) {
    throw new AiProviderHttpError(provider.providerName, 0, first.value.message);
  }
  return { iterator, first };
}
