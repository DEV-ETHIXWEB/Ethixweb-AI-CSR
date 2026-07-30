/**
 * Per-dependency circuit breaker, per docs/08-security-observability-reliability.md §3
 * ("wraps each external dependency (per-tenant, per-CRM-adapter)"). Generic —
 * used for CRM adapters, LLM providers (docs/21 §1), notification senders, etc.
 */
export type CircuitState = "closed" | "open" | "half_open";

export interface CircuitBreakerOptions {
  /** Consecutive failures before the circuit opens. Default 5. */
  failureThreshold?: number;
  /** How long the circuit stays open before allowing a half-open trial. Default 30000ms. */
  resetTimeoutMs?: number;
}

export class CircuitOpenError extends Error {
  constructor(public readonly circuitKey: string) {
    super(`Circuit breaker is open for "${circuitKey}"`);
    this.name = "CircuitOpenError";
  }
}

const DEFAULT_FAILURE_THRESHOLD = 5;
const DEFAULT_RESET_TIMEOUT_MS = 30_000;

export class CircuitBreaker {
  private state: CircuitState = "closed";
  private consecutiveFailures = 0;
  private openedAt: number | null = null;
  // Exactly one trial call is ever in flight while half-open — a boolean,
  // not a counter. An earlier version supported a configurable number of
  // concurrent half-open trials via a counter decremented in `finally`, but
  // that decrement checked `this.state === "half_open"` *after*
  // onSuccess()/onFailure() had already mutated `state` away from
  // "half_open" — so with more than one trial in flight, whichever call
  // resolved first would flip the breaker's state (closed or re-opened)
  // while a second concurrent trial was still running; when that second
  // call then resolved, it mutated a breaker that was no longer actually
  // half-open, corrupting the transition. Single-trial half-open is both
  // the industry-standard default and the only variant that composes
  // correctly with a state machine this simple — removed the broken
  // generality instead of working around it.
  private halfOpenTrialInFlight = false;

  constructor(
    private readonly key: string,
    private readonly options: CircuitBreakerOptions = {},
  ) {}

  getState(): CircuitState {
    this.maybeTransitionToHalfOpen();
    return this.state;
  }

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    this.maybeTransitionToHalfOpen();

    if (this.state === "open") {
      throw new CircuitOpenError(this.key);
    }
    if (this.state === "half_open") {
      if (this.halfOpenTrialInFlight) {
        throw new CircuitOpenError(this.key);
      }
      this.halfOpenTrialInFlight = true;
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    } finally {
      this.halfOpenTrialInFlight = false;
    }
  }

  private maybeTransitionToHalfOpen(): void {
    if (this.state !== "open" || this.openedAt === null) {
      return;
    }
    const resetTimeoutMs = this.options.resetTimeoutMs ?? DEFAULT_RESET_TIMEOUT_MS;
    if (Date.now() - this.openedAt >= resetTimeoutMs) {
      this.state = "half_open";
      this.halfOpenTrialInFlight = false;
    }
  }

  private onSuccess(): void {
    this.consecutiveFailures = 0;
    this.state = "closed";
    this.openedAt = null;
  }

  private onFailure(): void {
    this.consecutiveFailures += 1;
    if (this.state === "half_open") {
      this.open();
      return;
    }
    const failureThreshold = this.options.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD;
    if (this.consecutiveFailures >= failureThreshold) {
      this.open();
    }
  }

  private open(): void {
    this.state = "open";
    this.openedAt = Date.now();
  }
}

/**
 * Keyed registry so callers get one breaker per (tenant, dependency) pair
 * without hand-rolling a Map at every call site — e.g.
 * `registry.getOrCreate(\`hcp:${tenantId}\`)`.
 */
export class CircuitBreakerRegistry {
  private readonly breakers = new Map<string, CircuitBreaker>();

  constructor(private readonly defaultOptions: CircuitBreakerOptions = {}) {}

  getOrCreate(key: string, options?: CircuitBreakerOptions): CircuitBreaker {
    const existing = this.breakers.get(key);
    if (existing) {
      return existing;
    }
    const breaker = new CircuitBreaker(key, options ?? this.defaultOptions);
    this.breakers.set(key, breaker);
    return breaker;
  }
}
