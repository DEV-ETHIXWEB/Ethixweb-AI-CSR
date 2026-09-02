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
    const chunks = this.responses[Math.min(this.callIndex, this.responses.length - 1)] ?? [];
    this.callIndex += 1;
    for (const chunk of chunks) {
      yield chunk;
    }
  }
}
