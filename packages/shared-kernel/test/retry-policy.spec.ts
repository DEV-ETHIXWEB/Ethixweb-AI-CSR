import { describe, expect, it, vi } from "vitest";
import { RetryExhaustedError, withRetry } from "../src/retry/retry-policy";

describe("withRetry", () => {
  it("returns the result immediately on first success without sleeping", async () => {
    const operation = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(operation, { maxAttempts: 3 });
    expect(result).toBe("ok");
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("retries transient failures until success, using small delays for the test", async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new Error("transient 1"))
      .mockRejectedValueOnce(new Error("transient 2"))
      .mockResolvedValue("ok");

    const result = await withRetry(operation, {
      maxAttempts: 5,
      baseDelayMs: 1,
      maxDelayMs: 2,
    });

    expect(result).toBe("ok");
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it("throws RetryExhaustedError after exhausting all attempts", async () => {
    const lastError = new Error("still failing");
    const operation = vi.fn().mockRejectedValue(lastError);

    await expect(
      withRetry(operation, { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 1 }),
    ).rejects.toThrow(RetryExhaustedError);
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it("propagates a non-retryable error immediately, unwrapped, without exhausting attempts", async () => {
    class PermanentError extends Error {}
    const operation = vi.fn().mockRejectedValue(new PermanentError("bad request"));

    await expect(
      withRetry(operation, {
        maxAttempts: 5,
        baseDelayMs: 1,
        isRetryable: (error) => !(error instanceof PermanentError),
      }),
    ).rejects.toBeInstanceOf(PermanentError);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("fails fast on maxAttempts: 0 instead of silently reporting exhaustion without ever calling the operation", async () => {
    const operation = vi.fn().mockResolvedValue("ok");
    await expect(withRetry(operation, { maxAttempts: 0 })).rejects.toThrow(RangeError);
    expect(operation).not.toHaveBeenCalled();
  });

  it("calls onRetry with the attempt number and computed delay before each retry", async () => {
    const onRetry = vi.fn();
    const operation = vi.fn().mockRejectedValueOnce(new Error("fail once")).mockResolvedValue("ok");

    await withRetry(operation, { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 1, onRetry });

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry.mock.calls[0]?.[0]).toBe(1);
  });
});
