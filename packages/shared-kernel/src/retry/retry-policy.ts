/**
 * Exponential backoff + jitter retry, per docs/01-architecture-overview.md §6.
 * A non-retryable error (per `isRetryable`) propagates immediately, unwrapped —
 * callers/DLQ handlers rely on inspecting the original error's type/shape.
 * Once attempts are genuinely exhausted, {@link RetryExhaustedError} wraps the
 * last error so callers can route to a dead letter queue uniformly.
 */
export interface RetryPolicyOptions {
  /** Default 6, matching the platform-wide default in docs/01 §6. */
  maxAttempts?: number;
  /** Default 1000ms — the "1s, 4s, 16s, 64s..." progression in docs/01 §6. */
  baseDelayMs?: number;
  /** Ceiling on the exponential delay before jitter is applied. Default 64000ms. */
  maxDelayMs?: number;
  /** Proportional jitter applied to each delay, e.g. 0.2 = ±20%. Default 0.2. */
  jitterRatio?: number;
  /** Return false for permanent failures (4xx validation/auth) per docs/04 §3.2. Default: always retryable. */
  isRetryable?: (error: unknown) => boolean;
  /** Invoked before each retry sleep — primarily for observability/logging hooks. */
  onRetry?: (attempt: number, delayMs: number, error: unknown) => void;
}

export class RetryExhaustedError extends Error {
  constructor(
    public readonly attempts: number,
    public readonly lastError: unknown,
  ) {
    super(`Retry exhausted after ${attempts} attempt(s)`);
    this.name = "RetryExhaustedError";
  }
}

const DEFAULT_MAX_ATTEMPTS = 6;
const DEFAULT_BASE_DELAY_MS = 1000;
const DEFAULT_MAX_DELAY_MS = 64_000;
const DEFAULT_JITTER_RATIO = 0.2;

export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryPolicyOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const jitterRatio = options.jitterRatio ?? DEFAULT_JITTER_RATIO;
  const isRetryable = options.isRetryable ?? (() => true);

  // Fail fast on misconfiguration rather than silently reporting "exhausted"
  // without ever calling `operation()` — `maxAttempts <= 0` used to fall
  // through the loop straight to the unreachable-in-theory final throw
  // below, which was reachable in practice for exactly this case.
  if (maxAttempts < 1) {
    throw new RangeError(`withRetry: maxAttempts must be >= 1, got ${maxAttempts}`);
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (!isRetryable(error)) {
        throw error;
      }
      if (attempt === maxAttempts) {
        throw new RetryExhaustedError(attempt, error);
      }
      const delayMs = computeBackoffDelay(attempt, baseDelayMs, maxDelayMs, jitterRatio);
      options.onRetry?.(attempt, delayMs, error);
      await sleep(delayMs);
    }
  }

  /* istanbul ignore next -- loop always returns or throws above */
  throw new RetryExhaustedError(maxAttempts, undefined);
}

function computeBackoffDelay(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  jitterRatio: number,
): number {
  const exponential = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
  const jitter = exponential * jitterRatio * (Math.random() * 2 - 1);
  return Math.max(0, Math.round(exponential + jitter));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
