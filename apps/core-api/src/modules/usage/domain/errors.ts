import { ValidationDomainError } from "../../../shared/domain/domain-error";

/**
 * `quantity` must be a non-negative integer — thrown before any DB write is
 * attempted, per docs/04-ai-tool-architecture.md §2's "structured error
 * back to the caller, not a silent coercion" discipline applied here to
 * usage ingestion instead of tool calls.
 */
export class InvalidUsageQuantityError extends ValidationDomainError {
  constructor(public readonly quantity: number) {
    super(`Usage quantity must be a non-negative integer, got: ${quantity}`);
    this.name = "InvalidUsageQuantityError";
  }
}

/** `occurredAt` in the future — almost always a clock-skew or caller bug, not a legitimate usage event; rejected rather than silently accepted (docs/26 §12's reconciliation discussion depends on `occurredAt` being trustworthy). */
export class UsageOccurredInFutureError extends ValidationDomainError {
  constructor(public readonly occurredAt: string) {
    super(`Usage occurredAt is in the future: ${occurredAt}`);
    this.name = "UsageOccurredInFutureError";
  }
}

/** A non-positive or inverted `[from, to)` window — every summary query is a half-open interval; anything else can't be tiled into consecutive billing periods without double-counting or gaps. */
export class InvalidUsagePeriodError extends ValidationDomainError {
  constructor(
    public readonly from: string,
    public readonly to: string,
  ) {
    super(`Invalid usage period: from (${from}) must be strictly before to (${to})`);
    this.name = "InvalidUsagePeriodError";
  }
}
