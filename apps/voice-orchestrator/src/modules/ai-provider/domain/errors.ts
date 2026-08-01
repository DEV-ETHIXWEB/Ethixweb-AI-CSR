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
