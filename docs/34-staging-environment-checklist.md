# 34 — Staging Environment Checklist

## 1. Staging requirements, split by when they're actually needed

### Required before first test call (Yash's runtime + this backend talking to each other, no real customer traffic)

- [ ] `core-api` deployed and reachable (can be a single instance, doesn't need to be highly available yet).
- [ ] `voice-orchestrator` deployed and reachable.
- [ ] PostgreSQL reachable from `core-api` (can be a single small instance).
- [ ] Redis reachable from `voice-orchestrator`.
- [ ] Yash's runtime deployed and able to reach `voice-orchestrator`'s staging URL.
- [ ] `ORCHESTRATOR_SERVICE_TOKEN`, `CORE_API_SERVICE_API_KEY` generated for this environment (see [docs/25-service-credential-provisioning.md](25-service-credential-provisioning.md) for the exact API-key issuance call) and set identically on both sides where shared.
- [ ] At least one test tenant/business provisioned with business hours, service areas, emergency rules.
- [ ] Logging enabled and reviewable (even just captured stdout is enough at this stage).

### Required before production (real customer traffic)

Everything above, plus:

- [ ] HTTPS on every public-facing endpoint (no plaintext HTTP for anything carrying tenant data or bearer tokens).
- [ ] HCP live credentials provisioned per real client tenant ([docs/29](29-phase11-12-blocker-resolution.md) Blocker 2).
- [ ] STT/TTS/telephony vendor accounts fully provisioned (Yash's side).
- [ ] LLM provider API keys with production-appropriate rate limits/spend controls.
- [ ] Real notification destinations (not test numbers/webhooks) configured per tenant.
- [ ] Secrets stored in a real secret manager, not `.env` files on a server (this repo currently validates env vars at boot but does not mandate any particular secret-storage backend — that's a deployment-topology decision, not something this codebase enforces).
- [ ] Monitoring: dashboards showing call volume, error rates, latency — **not currently built** (flagged as a gap in the Phase 12 audit, not fabricated as done).
- [ ] Alerting: a real alerting provider (PagerDuty/Opsgenie/equivalent) wired to failure conditions — **not currently built**.
- [ ] A rollback path that doesn't strand a caller with no working phone line (see [docs/29](29-phase11-12-blocker-resolution.md) Blocker 5, and the rollback note in the Phase 12 report — no repo-level "kill switch" tooling exists yet; today this would be a manual telephony-routing change on Yash's side).

### Optional (nice to have, not blocking)

- [ ] Staging-specific subdomain naming convention.
- [ ] Automatic staging data reset/cleanup between test runs.
- [ ] A dedicated staging Slack/notification channel separate from the real office notification channel, so staging tests don't spam real staff.

## 2. Ensuring staging cannot affect production

- Staging and production must use **entirely separate** database instances, Redis instances, and HCP accounts (a staging tenant pointed at a real HCP production account would create real customer/job records — do not do this).
- Staging's `ORCHESTRATOR_SERVICE_TOKEN`/`CORE_API_SERVICE_API_KEY` must differ from production's — confirmed by inspection that these are plain environment variables with no built-in environment-awareness, so this discipline is entirely operational, not enforced by the code.
- Staging notification channels must point to test destinations, never real office phone numbers/emails, until deliberately promoting a specific tenant to production.

## 3. Production configuration matrix

Every variable, across both services, with ownership and secrecy noted. Values are never included here.

### `voice-orchestrator` (from `apps/voice-orchestrator/src/shared/config/env.schema.ts`, confirmed by direct read)

| Variable                                                  | Local                   | Staging               | Production              | Owner                   | Secret? | Required?           | Purpose                    |
| --------------------------------------------------------- | ----------------------- | --------------------- | ----------------------- | ----------------------- | ------- | ------------------- | -------------------------- |
| `NODE_ENV`                                                | `development`           | `production`          | `production`            | Deploy config           | No      | No (defaults)       | Runtime mode               |
| `PORT`                                                    | `3100`                  | per-deploy            | per-deploy              | Deploy config           | No      | No (defaults)       | HTTP listen port           |
| `REDIS_URL`                                               | local Redis             | staging Redis         | production Redis        | Infra owner             | Yes     | **Yes**             | Conversation session store |
| `CORE_API_BASE_URL`                                       | `http://localhost:3000` | staging core-api URL  | production core-api URL | Infra owner             | No      | **Yes**             | Where to reach core-api    |
| `CORE_API_SERVICE_API_KEY`                                | issued per docs/25      | issued per env        | issued per env          | Backend owner           | Yes     | **Yes**             | Service auth to core-api   |
| `ORCHESTRATOR_SERVICE_TOKEN`                              | shared dev secret       | shared staging secret | shared prod secret      | Backend + Yash, jointly | Yes     | **Yes**             | Runtime→orchestrator auth  |
| `LOG_LEVEL`                                               | `debug`                 | `info`                | `info`/`warn`           | Deploy config           | No      | No                  | Log verbosity              |
| `OTEL_*`                                                  | optional                | optional              | recommended             | Infra owner             | No      | No                  | Tracing                    |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` | at least one            | at least one          | at least one            | Backend owner           | Yes     | No (≥1 recommended) | LLM providers              |
| `AI_PROVIDER_FALLBACK_ORDER`                              | optional                | optional              | recommended             | Backend owner           | No      | No                  | Provider fallback order    |
| `DEFAULT_LLM_MODEL`                                       | optional                | optional              | recommended             | Backend owner           | No      | No                  | Default model              |

### `core-api` (from `apps/core-api/src/shared/config/env.schema.ts`, confirmed by direct read)

| Variable                                                          | Local                  | Staging                      | Production                   | Owner                  | Secret?     | Required?                              | Purpose                                                                         |
| ----------------------------------------------------------------- | ---------------------- | ---------------------------- | ---------------------------- | ---------------------- | ----------- | -------------------------------------- | ------------------------------------------------------------------------------- |
| `NODE_ENV`                                                        | `development`          | `production`                 | `production`                 | Deploy config          | No          | No                                     | Runtime mode                                                                    |
| `PORT`                                                            | `3000`                 | per-deploy                   | per-deploy                   | Deploy config          | No          | No                                     | HTTP listen port                                                                |
| `DATABASE_URL`                                                    | local Postgres         | staging Postgres             | production Postgres          | Infra owner            | Yes         | **Yes**                                | App DB connection (as `app_runtime`, not migration owner — RLS depends on this) |
| `REDIS_URL`                                                       | local Redis            | staging Redis                | production Redis             | Infra owner            | Yes         | **Yes**                                | core-api's own Redis usage                                                      |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET`                        | dev secret             | staging secret               | prod secret                  | Backend owner          | Yes         | **Yes**                                | Dashboard/user auth tokens                                                      |
| `JWT_ACCESS_TTL_SECONDS` / `JWT_REFRESH_TTL_SECONDS`              | optional               | optional                     | recommended explicit         | Backend owner          | No          | No                                     | Token lifetimes                                                                 |
| `INTEGRATION_CREDENTIALS_MASTER_KEY`                              | dev key (64 hex chars) | staging key                  | prod key                     | Backend owner          | Yes         | **Yes**                                | Encrypts stored CRM credentials (HCP, etc.)                                     |
| `LOG_LEVEL`                                                       | `debug`                | `info`                       | `info`/`warn`                | Deploy config          | No          | No                                     | Log verbosity                                                                   |
| `OTEL_*`                                                          | optional               | optional                     | recommended                  | Infra owner            | No          | No                                     | Tracing                                                                         |
| `TWILIO_AUTH_TOKEN` / `TWILIO_ACCOUNT_SID` / `TWILIO_FROM_NUMBER` | optional               | needed for SMS notifications | needed for SMS notifications | Backend owner          | Yes (token) | No (fails closed per-request if unset) | SMS notification channel                                                        |
| `HOUSECALL_PRO_API_BASE_URL`                                      | optional (has default) | confirm real value           | confirm real value           | Backend owner          | No          | No                                     | HCP API target — **confirm the default isn't silently used in production**      |
| HCP credentials (per-tenant, DB-stored, encrypted)                | test account           | sandbox account              | real client account          | Business/account owner | Yes         | Yes per active tenant                  | CRM integration                                                                 |

**Never commit actual values for any row marked Secret: Yes.** All secret rows above are placeholders in `.env.example` only.

## 4. Rotation procedure (brief)

Not detailed further here since no rotation tooling exists in this repo to document — this is a manual, deployment-target-specific operational procedure (regenerate the secret, update it in the secret store, redeploy/restart the affected service(s), confirm the old value stops working). Flagged as a genuine gap for whoever owns production operations, not fabricated as automated.
