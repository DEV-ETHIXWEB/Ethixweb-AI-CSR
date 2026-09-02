import type { CircuitBreakerRegistry } from "@ethixweb/shared-kernel";
import type {
  AiCompletionChunk,
  AiCompletionRequest,
  AiProviderPort,
} from "../domain/ai-provider.port";
import { AiProviderHttpError } from "../domain/errors";

// None of the three provider adapters (Anthropic/OpenAI/Gemini) bound
// their own fetch() call, and the ONLY AbortSignal HandleTurnUseCase ever
// supplies is barge-in interrupt, undefined on an ordinary turn. Found by
// tracing the exact same "no timeout anywhere on this path" bug class
// HttpCoreApiClient turned out to have (fixed separately, live-reproduced
// there): if a live LLM vendor's connection ever hangs (accepts the
// request, never sends a byte back) rather than erroring outright, a real
// caller would be left in dead air for the rest of the call, no live
// credentials in this environment to reproduce the vendor side directly,
// but the code path is unambiguous: nothing here would ever time out.
// Combined with the caller's own interrupt signal (via AbortSignal.any)
// so barge-in still aborts immediately as before, this is purely an
// additional upper bound for the case neither success nor interrupt ever
// arrives. Generous relative to the tool-broker's own 1-3s per-tool
// budgets since a full multi-sentence streamed response legitimately
// takes longer than a single tool call, this is a last-resort backstop,
// not a normal-path latency target.
const STREAM_TIMEOUT_MS = 15_000;

/**
 * Fallback Strategy (docs task item 3, "AI Provider Layer"): tries
 * providers in the configured order, one per-provider circuit breaker
 * (shared-kernel's CircuitBreakerRegistry, the same primitive CRM
 * adapters use) so a provider that's currently down is skipped instantly
 * rather than retried on every single turn. Only the FIRST chunk of a
 * stream decides fail-over, once real content has started flowing to
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
    // Why each provider was skipped, not just that it was. Previously the
    // `catch { continue; }` below discarded the reason entirely, so a total
    // outage surfaced as "All AI providers failed or are unavailable: gemini"
    // with no cause anywhere — an operator (or anyone debugging a dead call)
    // had nothing to act on. Cost a real debugging session to a Gemini 400
    // that was fully described in an error this loop threw away.
    const failures: string[] = [];
    const boundedSignal = combineWithTimeout(signal);

    for (const provider of this.providers) {
      const breaker = this.circuitBreakers.getOrCreate(provider.providerName);
      attempted.push(provider.providerName);

      let probe: {
        iterator: AsyncIterator<AiCompletionChunk>;
        first: IteratorResult<AiCompletionChunk>;
      };
      try {
        probe = await breaker.execute(() => probeFirstChunk(provider, request, boundedSignal));
      } catch (error) {
        failures.push(
          `${provider.providerName}: ${error instanceof Error ? error.message : String(error)}`,
        );
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
      message:
        `All AI providers failed or are unavailable: ${attempted.join(", ")}` +
        (failures.length > 0 ? ` (${failures.join("; ")})` : ""),
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
  // content streamed) is treated as THIS provider's failure, recorded by
  // the circuit breaker via the throw, so the caller falls through to
  // the next configured provider instead of surfacing it to the caller.
  if (!first.done && first.value.type === "error" && first.value.retryable) {
    throw new AiProviderHttpError(provider.providerName, 0, first.value.message);
  }
  return { iterator, first };
}

/**
 * One shared timeout for the whole streamCompletion call (every provider
 * attempted, not reset per provider): once STREAM_TIMEOUT_MS has genuinely
 * elapsed with neither a response nor an interrupt, trying a second
 * provider for another full timeout window would only compound an already
 * bad worst case, not improve it. A signal that's already fired stays
 * fired, so fetch() rejects any later provider attempt immediately rather
 * than hanging again, the fallback loop still runs, it just fails fast.
 */
function combineWithTimeout(signal: AbortSignal | undefined): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(STREAM_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
}
