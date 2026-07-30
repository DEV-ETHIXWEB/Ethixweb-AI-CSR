import { metrics } from "@opentelemetry/api";

/**
 * OTel Metrics API — vendor-neutral (docs/08-security-observability-reliability.md
 * §2.1), exported via the same OTel Collector pipeline as traces/logs.
 * Counters are defined once, here, and imported by whichever module's
 * use-cases increment them — one place to find every metric this service
 * emits, rather than scattered `meter.createCounter()` calls at each call
 * site.
 */
const meter = metrics.getMeter("core-api");

export const tenantsCreatedCounter = meter.createCounter("tenants_created_total", {
  description: "Number of tenants created",
});

export const tenantStatusTransitionsCounter = meter.createCounter(
  "tenant_status_transitions_total",
  { description: "Number of tenant lifecycle status transitions" },
);

export const businessesCreatedCounter = meter.createCounter("businesses_created_total", {
  description: "Number of businesses created",
});

export const authLoginAttemptsCounter = meter.createCounter("auth_login_attempts_total", {
  description:
    'Login attempts, labeled by outcome ("success" | "invalid_credentials" | "rate_limited")',
});

export const authRefreshTokenRotationsCounter = meter.createCounter(
  "auth_refresh_token_rotations_total",
  {
    description:
      'Refresh token rotation attempts, labeled by outcome ("success" | "invalid_token" | "user_not_found")',
  },
);

export const authApiKeyAuthenticationsCounter = meter.createCounter(
  "auth_api_key_authentications_total",
  {
    description: 'API key authentication attempts, labeled by outcome ("success" | "invalid_key")',
  },
);
