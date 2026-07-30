import { describe, expect, it, vi } from "vitest";
import {
  CircuitBreaker,
  CircuitBreakerRegistry,
  CircuitOpenError,
} from "../src/retry/circuit-breaker";

describe("CircuitBreaker", () => {
  it("stays closed and passes through successful calls", async () => {
    const breaker = new CircuitBreaker("test", { failureThreshold: 3 });
    const result = await breaker.execute(async () => "ok");
    expect(result).toBe("ok");
    expect(breaker.getState()).toBe("closed");
  });

  it("opens after reaching the consecutive failure threshold", async () => {
    const breaker = new CircuitBreaker("test", { failureThreshold: 2 });
    const failing = async () => {
      throw new Error("boom");
    };

    await expect(breaker.execute(failing)).rejects.toThrow("boom");
    expect(breaker.getState()).toBe("closed");

    await expect(breaker.execute(failing)).rejects.toThrow("boom");
    expect(breaker.getState()).toBe("open");
  });

  it("rejects immediately with CircuitOpenError while open, without calling the operation", async () => {
    const breaker = new CircuitBreaker("test", { failureThreshold: 1 });
    const operation = vi.fn().mockRejectedValue(new Error("boom"));

    await expect(breaker.execute(operation)).rejects.toThrow("boom");
    expect(breaker.getState()).toBe("open");

    await expect(breaker.execute(operation)).rejects.toThrow(CircuitOpenError);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("transitions to half-open after the reset timeout and closes again on a successful trial", async () => {
    const breaker = new CircuitBreaker("test", {
      failureThreshold: 1,
      resetTimeoutMs: 10,
    });

    await expect(
      breaker.execute(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(breaker.getState()).toBe("open");

    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(breaker.getState()).toBe("half_open");

    const result = await breaker.execute(async () => "recovered");
    expect(result).toBe("recovered");
    expect(breaker.getState()).toBe("closed");
  });

  it("reopens immediately if the half-open trial call fails", async () => {
    const breaker = new CircuitBreaker("test", {
      failureThreshold: 1,
      resetTimeoutMs: 10,
    });

    await expect(
      breaker.execute(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(breaker.getState()).toBe("half_open");

    await expect(
      breaker.execute(async () => {
        throw new Error("still broken");
      }),
    ).rejects.toThrow("still broken");
    expect(breaker.getState()).toBe("open");
  });

  it("rejects a second concurrent call while a half-open trial is still in flight, and lets the state settle correctly once it resolves", async () => {
    // Regression test: an earlier implementation tracked half-open trials
    // with a counter decremented in a `finally` block that checked
    // `state === "half_open"` — but onSuccess()/onFailure() had already
    // mutated `state` away from "half_open" by the time `finally` ran, so
    // a second concurrent trial call could corrupt the transition decided
    // by the first. This proves only one trial is ever admitted, and the
    // breaker's final state reflects that one trial's real outcome.
    const breaker = new CircuitBreaker("test", { failureThreshold: 1, resetTimeoutMs: 10 });

    await expect(
      breaker.execute(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(breaker.getState()).toBe("half_open");

    let releaseTrial: () => void = () => undefined;
    const trialGate = new Promise<void>((resolve) => {
      releaseTrial = resolve;
    });
    const firstTrial = breaker.execute(async () => {
      await trialGate;
      return "recovered";
    });

    // A second call arriving while the first trial is still pending must be
    // rejected outright, not admitted as a second concurrent trial.
    await expect(breaker.execute(async () => "should never run")).rejects.toThrow(CircuitOpenError);

    releaseTrial();
    await expect(firstTrial).resolves.toBe("recovered");
    expect(breaker.getState()).toBe("closed");
  });
});

describe("CircuitBreakerRegistry", () => {
  it("returns the same breaker instance for the same key", () => {
    const registry = new CircuitBreakerRegistry();
    const a = registry.getOrCreate("hcp:tenant-1");
    const b = registry.getOrCreate("hcp:tenant-1");
    expect(a).toBe(b);
  });

  it("returns independent breakers for different keys", async () => {
    const registry = new CircuitBreakerRegistry({ failureThreshold: 1 });
    const tenantA = registry.getOrCreate("hcp:tenant-a");
    const tenantB = registry.getOrCreate("hcp:tenant-b");

    await expect(
      tenantA.execute(async () => {
        throw new Error("tenant A's CRM is down");
      }),
    ).rejects.toThrow();

    expect(tenantA.getState()).toBe("open");
    expect(tenantB.getState()).toBe("closed");
  });
});
