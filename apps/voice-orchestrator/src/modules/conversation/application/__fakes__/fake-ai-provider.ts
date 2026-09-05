import type {
  AiCompletionChunk,
  AiCompletionRequest,
  AiProviderPort,
} from "../../../ai-provider/domain/ai-provider.port";

export class FakeAiProvider implements AiProviderPort {
  readonly providerName = "fake";
  /** Each call to streamCompletion consumes the next queued response in order — lets a test script a multi-turn tool-calling loop (first response: tool_call, second response: text). */
  public responses: AiCompletionChunk[][] = [
    [
      { type: "text_delta", text: "hi" },
      { type: "done", stopReason: "end_turn" },
    ],
  ];
  public readonly requests: AiCompletionRequest[] = [];
  /**
   * Consumed in lockstep with `responses` (same call index) — when set for
   * the current call, thrown from INSIDE the generator right after that
   * call's queued chunks are yielded. Models a genuinely thrown exception
   * mid-stream (a malformed JSON payload from the vendor, a connection
   * reset while iterating) — distinct from a well-formed `{type:"error"}`
   * chunk, which every other fake response already covers. Found live:
   * anthropic.adapter.ts's own JSON.parse can throw exactly this shape on
   * a malformed SSE payload, and HandleTurnUseCase's "AI provider stream
   * failed mid-turn" catch branch existed with zero test coverage until
   * this was added specifically to exercise it.
   */
  public throwAfterChunks: Array<Error | null> = [];
  private callIndex = 0;

  /**
   * Clears recorded request/index bookkeeping without touching `responses`
   * — for a test that wants to isolate call-start's own opening-greeting
   * completion (StartConversationUseCase.generateGreeting) from whatever
   * it's actually testing about the turns that follow, so `responses[0]`
   * still means "the first turn I'm testing," not "whatever the greeting
   * happened to consume." Never called automatically; a test (or a shared
   * helper like an e2e spec's `startConversation()`) opts into it.
   */
  reset(): void {
    this.requests.length = 0;
    this.callIndex = 0;
  }

  async *streamCompletion(
    request: AiCompletionRequest,
    _signal?: AbortSignal,
  ): AsyncIterable<AiCompletionChunk> {
    this.requests.push(request);
    const index = this.callIndex;
    const chunks = this.responses[Math.min(index, this.responses.length - 1)] ?? [];
    const throwAfter = this.throwAfterChunks[index];
    this.callIndex += 1;
    for (const chunk of chunks) {
      yield chunk;
    }
    if (throwAfter) {
      throw throwAfter;
    }
  }
}
