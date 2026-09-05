export class AiProviderHttpError extends Error {
  constructor(
    public readonly providerName: string,
    public readonly status: number,
    message: string,
  ) {
    super(`${providerName} request failed (${status}): ${message}`);
    this.name = "AiProviderHttpError";
  }

  /** 429/5xx are transient; 4xx (other than 429) are permanent — mirrors CRM adapters' own retry classification (docs/04 §3.2). */
  get isRetryable(): boolean {
    return this.status === 429 || this.status >= 500;
  }
}

export class AllAiProvidersFailedError extends Error {
  constructor(public readonly attemptedProviders: string[]) {
    super(`All AI providers failed or are unconfigured: ${attemptedProviders.join(", ")}`);
    this.name = "AllAiProvidersFailedError";
  }
}

/**
 * FOUND LIVE: every provider adapter already computes a correct retryable/
 * permanent classification per error (AiProviderHttpError.isRetryable above,
 * mirrored by every other adapter's own error chunk) and yields it faithfully
 * as `AiCompletionChunk`'s `{type: "error", retryable}` field — but
 * HandleTurnUseCase.streamOneCompletion previously only ever kept the
 * chunk's `message`, threw a plain `Error`, and ConversationsController's
 * catch block then hardcoded `retryable: true` on every single failure
 * regardless of cause. The real cost: a genuinely PERMANENT failure (e.g.
 * the role:"system" compaction bug this error class was added to carry the
 * fix for) still cost the caller ~2.5s of dead air retried three times
 * against an error that could never succeed, before finally apologizing —
 * every future bug of this same shape would pay the identical tax. This
 * class carries the adapter's own classification the rest of the way to
 * the wire instead of discarding it twice.
 */
export class ProviderCompletionError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
  ) {
    super(`AI provider completion failed: ${message}`);
    this.name = "ProviderCompletionError";
  }
}
