import { Inject, Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { RateLimitExceededError } from "../../domain/errors";
import { RATE_LIMITER, type RateLimiter } from "../../domain/ports/rate-limiter.port";
import type { RequestWithPrincipal } from "../../../../shared/auth/request-principal";

// Generous enough for legitimate real-time voice traffic (a tenant at its
// default 10-concurrent-call capacity ceiling, each call making several
// tool calls per turn — searchCustomer, createCustomer, createLead,
// escalateEmergency, getBusinessHours, usage recording), while still
// bounding a genuinely runaway caller (a retry-storm bug, a compromised
// API key) rather than leaving core-api's internal/* surface completely
// unbounded, which it was before this guard existed.
const MAX_REQUESTS_PER_WINDOW = 300;
const WINDOW_SECONDS = 60;

/**
 * docs/13-implementation-backlog.md `tool-broker` module backlog item 5:
 * "Rate limiter integration (per-tenant token bucket, Redis)" — planned
 * from the start, never actually built anywhere in this codebase (found
 * during a security audit pass: core-api's `internal/*` tool-broker
 * surface — createLead, createCustomer, startCall, escalateEmergency, etc.
 * — had zero request-volume protection). Registered as a global
 * `APP_GUARD` in `auth.module.ts`, the same mechanism as `AuthGuard`/
 * `RolesGuard`, so it applies to every route without every module needing
 * to import `AuthModule` — but scoped to fire ONLY on `api_key`-authenticated
 * requests (the actual tool-broker/service-to-service traffic this gap is
 * about), never on JWT-authenticated dashboard traffic, which is a
 * different, lower-abuse-risk category with its own (human-scale) usage
 * pattern.
 *
 * Runs AFTER `AuthGuard` (both `APP_GUARD`s, registered in declaration
 * order — `AuthGuard` first in `auth.module.ts`'s providers array) so
 * `request.principal` already exists by the time this checks it.
 */
@Injectable()
export class ServiceRateLimitGuard implements CanActivate {
  constructor(@Inject(RATE_LIMITER) private readonly rateLimiter: RateLimiter) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithPrincipal>();
    const principal = request.principal;

    // No principal (a @Public() route AuthGuard let through) or a JWT
    // principal (human dashboard traffic) — not this guard's concern.
    if (!principal || principal.authType !== "api_key") {
      return true;
    }

    const key = `service:${principal.tenantId}`;
    const result = await this.rateLimiter.consume(key, MAX_REQUESTS_PER_WINDOW, WINDOW_SECONDS);
    if (!result.allowed) {
      throw new RateLimitExceededError(result.retryAfterSeconds);
    }
    return true;
  }
}
