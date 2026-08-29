import type { ExecutionContext } from "@nestjs/common";
import type {
  AuthPrincipal,
  RequestWithPrincipal,
} from "../../../../shared/auth/request-principal";
import { RateLimitExceededError } from "../../domain/errors";
import type { RateLimiter, RateLimitResult } from "../../domain/ports/rate-limiter.port";
import { ServiceRateLimitGuard } from "./service-rate-limit.guard";

function buildContext(principal: AuthPrincipal | undefined): ExecutionContext {
  const request: RequestWithPrincipal = { principal } as RequestWithPrincipal;
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

class FakeRateLimiter implements RateLimiter {
  result: RateLimitResult = { allowed: true };
  consumedKeys: string[] = [];

  async consume(key: string): Promise<RateLimitResult> {
    this.consumedKeys.push(key);
    return this.result;
  }
}

describe("ServiceRateLimitGuard", () => {
  it("allows a request through with no principal at all (a @Public() route AuthGuard already let through)", async () => {
    const rateLimiter = new FakeRateLimiter();
    const guard = new ServiceRateLimitGuard(rateLimiter);

    await expect(guard.canActivate(buildContext(undefined))).resolves.toBe(true);
    expect(rateLimiter.consumedKeys).toHaveLength(0);
  });

  it("never rate-limits JWT-authenticated (dashboard) traffic — a different, lower-abuse-risk category", async () => {
    const rateLimiter = new FakeRateLimiter();
    rateLimiter.result = { allowed: false, retryAfterSeconds: 30 };
    const guard = new ServiceRateLimitGuard(rateLimiter);
    const context = buildContext({
      authType: "jwt",
      tenantId: "tenant-1",
      userId: "u1",
      role: "owner",
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(rateLimiter.consumedKeys).toHaveLength(0);
  });

  it("consumes a per-tenant rate limit slot for api_key-authenticated (tool-broker) traffic", async () => {
    const rateLimiter = new FakeRateLimiter();
    const guard = new ServiceRateLimitGuard(rateLimiter);
    const context = buildContext({
      authType: "api_key",
      tenantId: "tenant-1",
      apiKeyId: "key-1",
      scopes: "full",
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(rateLimiter.consumedKeys).toEqual(["service:tenant-1"]);
  });

  it("throws RateLimitExceededError once the tenant's window is exhausted", async () => {
    const rateLimiter = new FakeRateLimiter();
    rateLimiter.result = { allowed: false, retryAfterSeconds: 12 };
    const guard = new ServiceRateLimitGuard(rateLimiter);
    const context = buildContext({
      authType: "api_key",
      tenantId: "tenant-1",
      apiKeyId: "key-1",
      scopes: "full",
    });

    await expect(guard.canActivate(context)).rejects.toThrow(RateLimitExceededError);
  });

  it("scopes the rate limit key per tenant — two different tenants' API keys never share a bucket", async () => {
    const rateLimiter = new FakeRateLimiter();
    const guard = new ServiceRateLimitGuard(rateLimiter);

    await guard.canActivate(
      buildContext({ authType: "api_key", tenantId: "tenant-a", apiKeyId: "k1", scopes: "full" }),
    );
    await guard.canActivate(
      buildContext({ authType: "api_key", tenantId: "tenant-b", apiKeyId: "k2", scopes: "full" }),
    );

    expect(rateLimiter.consumedKeys).toEqual(["service:tenant-a", "service:tenant-b"]);
  });
});
