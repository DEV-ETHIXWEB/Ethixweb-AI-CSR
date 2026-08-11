# 29 — Phase 11/12 Blocker Resolution Checklist

The authoritative tracker for the five external blockers the Phase 11/12 audits identified. This file exists so that closing a blocker is a checklist item with a named owner and a defined test, not a vague "get Yash's runtime working" — and so nothing gets marked done without literal evidence.

**Status legend** — 🔴 RED: unavailable/blocking. 🟡 YELLOW: available but not yet verified. 🟢 GREEN: literally tested and verified (evidence attached below, not asserted).

Nothing in this document is currently GREEN. That is the honest state as of this writing, not an oversight.

---

## Blocker 1 — Yash's live voice runtime is not present/connected

**Status: 🔴 RED**

**Why it matters**: every downstream capability (real audio, real STT, real TTS, real barge-in, a real phone call reaching a real caller) is unreachable until a runtime process exists that speaks the contract in [docs/24](24-runtime-orchestrator-contract.md) / [docs/28](28-yash-runtime-integration-package.md). This is the single largest blocker — nothing else in this list can be tested end-to-end without it.

**Exact dependency/access required**: Yash's runtime deployed somewhere reachable over HTTP (local dev, staging, or a tunnel to this repo's `voice-orchestrator`), configured with a real `ORCHESTRATOR_SERVICE_TOKEN` matching this deployment's.

**Responsible**: Yash (runtime owner). Ethixweb repo side is already built and waiting — no repo work blocks this.

**Exact setup steps**:

1. Yash's runtime process boots and can reach `voice-orchestrator`'s base URL.
2. Both sides are configured with the identical `ORCHESTRATOR_SERVICE_TOKEN` value (out-of-band secret, never transmitted over an API).
3. Yash's runtime generates a `callId` (UUID) per call and calls `POST /v1/conversations` per [docs/28 §J](28-yash-runtime-integration-package.md#j-call-start-behavior--exact-sequence).

**Exact test to run**: [docs/31](31-first-real-phone-call-runbook.md) Test Call #1, or — before any real telephony exists — a scripted curl sequence against a running `voice-orchestrator` instance using the exact payloads in [docs/28 §P](28-yash-runtime-integration-package.md#p-example-payloads--a-complete-call-start-to-finish).

**Expected successful result**: `POST /conversations` → `201` with a `conversationId`; a subsequent `POST /:id/turns` → `200` with `responseText`; `POST /:id/end` → `200`.

**Evidence required to mark GREEN**: captured HTTP request/response logs (or curl output) from an actual call against Yash's actual runtime code — not the simulator (the simulator already proves the contract side; this blocker is specifically about a real runtime existing and speaking it correctly).

**Current status**: 🔴 no runtime observed to exist or be reachable from this environment.

**Next action**: get Yash's runtime running against a shared `voice-orchestrator` deployment (local or staging) and run the curl sequence in docs/28 §P together.

---

## Blocker 2 — Live HCP (Housecall Pro) credentials are unavailable

**Status: 🔴 RED**

**Why it matters**: `ResolveCustomerUseCase`, `createCustomer`, and lead flow are proven against a fake core-api client in the simulator (Phase 8/10), never against the real Housecall Pro API. Real customer search/create/timeout/error/rate-limit behavior is entirely unverified.

**Exact dependency/access required**: a Housecall Pro account (sandbox or production-adjacent test account) with API access, plus its API base URL and credentials.

**Responsible**: whoever owns the client relationship / HCP account provisioning (business side, not engineering — this is an account-creation and credential-issuance task, not a code task).

**Exact setup steps**:

1. Obtain HCP API credentials for a test/sandbox business.
2. Set `HOUSECALL_PRO_API_BASE_URL` (optional per `env.schema.ts`, defaults to a hardcoded value if unset — confirm the default is NOT what you want before assuming it's already configured) and the actual API credential (stored per-tenant via the existing encrypted-credential mechanism, `AesGcmCredentialEncryptor` — confirmed present in `core-api`'s env schema as `INTEGRATION_CREDENTIALS_MASTER_KEY`).
3. Provision the credential for one test tenant via the existing tenant-credential storage path (Phase 2/3 CRM integration module — unchanged, not rebuilt this phase).

**Exact test to run**: [docs/32-hcp-live-verification-checklist.md](32-hcp-live-verification-checklist.md), all 10 scenarios.

**Expected successful result**: real customer search/create/dedup/lead-create against the real HCP sandbox, matching the behavior already proven against the fake client.

**Evidence required to mark GREEN**: captured HCP API request/response pairs (with secrets redacted) for each of the 10 scenarios in docs/32, plus the corresponding database state.

**Current status**: 🔴 no HCP credentials available in this environment.

**Next action**: provision an HCP sandbox/test account and its credentials; hand them to whoever runs docs/32.

---

## Blocker 3 — Real PostgreSQL integration gate has not been executed

**Status: 🔴 RED**

**Why it matters**: `Lead.callId → Call.id` is a real database foreign key. Unit tests using `FakeLeadRepository` cannot prove the database will actually accept the insert — only a real Postgres instance can. This is the single most concrete, most mechanical blocker to resolve (it requires no external account, no vendor, just Docker or a reachable Postgres server).

**Exact dependency/access required**: Docker (for `testcontainers`, which the test itself already uses to spin up `postgres:16-alpine` automatically) — or, alternatively, any reachable PostgreSQL 16 server if Docker specifically is unavailable in the target environment.

**Responsible**: whoever has Docker-capable infrastructure (a developer machine with Docker Desktop, or a CI runner with Docker-in-Docker). This repo's own current session environment does not have Docker (`docker: command not found`, reconfirmed multiple times across Phases 10/11).

**Exact setup steps** (Docker/testcontainers path — the test already automates everything past "have Docker running"):

1. Install/start Docker on the machine that will run this test.
2. `cd apps/core-api`
3. `pnpm test:integration` (runs `jest --config jest.integration.config.js`)

No manual `DATABASE_URL`, no manual migration step, no manual seed step — the test file itself (`lead-call-fk-integrity.integration-spec.ts`) starts a `PostgreSqlContainer`, applies the 5 real migration files in order, creates the `app_runtime` role with a test password, points `PrismaService` at it, and tears the container down in `afterAll`. This is confirmed by direct reading of the test file, not assumed.

**Exact test command**: `pnpm --filter @ethixweb/core-api run test:integration`

**Expected successful result** (5 tests in `lead-call-fk-integrity.integration-spec.ts`):

1. Orphan `callId` insert fails with a real Postgres FK violation (23503).
2. `StartCallUseCase` → `createLead` succeeds cleanly against a real `calls` row.
3. The FK violation surfaces as `CallNotFoundForLeadError`, not a raw 500.
4. Concurrent duplicate `telephonyCallSid` calls resolve to one `calls` row, not two.
5. RLS still isolates the `calls` table between tenants.

Plus `tenant-isolation.integration-spec.ts` (3 tests, same command, same file glob) — confirms RLS isolation holds when connected as `app_runtime`, not the migration owner.

**Evidence required to mark GREEN**: literal terminal output showing `Tests: 8 passed, 8 total` (5 + 3) from an actual `pnpm test:integration` run — not a description of what the test does.

**Current status**: 🔴 unexecuted in every environment this project has been worked in so far (`docker: command not found`, reconfirmed this session).

**Next action**: run `pnpm --filter @ethixweb/core-api run test:integration` on any machine with Docker. This is the cheapest blocker to close — no external account or vendor negotiation required, purely an infrastructure-access problem.

---

## Blocker 4 — Live SIP/telephony emergency transfer is unavailable

**Status: 🔴 RED**

**Why it matters**: `escalateEmergency`'s `action: "forward_call"` is a signal _to the runtime_ — core-api and voice-orchestrator never place or transfer calls themselves (confirmed by architecture, docs/28 §M). The actual SIP transfer mechanism lives entirely in Yash's runtime and has never been exercised against a live trunk. This is the highest-stakes untested path in the whole system — a failure here means a real emergency caller does not reach a human.

**Exact dependency/access required**: a live SIP trunk or equivalent telephony transfer capability inside Yash's runtime, plus a real (or realistic test) destination number to transfer to.

**Responsible**: Yash (runtime owner) for the transfer mechanism itself; whoever owns the receiving phone line for confirming the human side.

**Exact setup steps**:

1. Blocker 1 must be resolved first (a live runtime must exist).
2. Yash's runtime must implement the actual transfer action in response to `action: "forward_call"`.
3. A real or test destination number must be configured to receive the transfer.

**Exact test to run**: [docs/33-emergency-live-verification-runbook.md](33-emergency-live-verification-runbook.md), all 6 scenarios.

**Expected successful result**: an emergency-triggering utterance during a real call results in the caller being connected to the configured human destination.

**Evidence required to mark GREEN**: a call recording or log trail showing detection → escalation → notification → transfer → human pickup, for at least one real test call.

**Current status**: 🔴 blocked on Blocker 1; no live SIP trunk available in this environment regardless.

**Next action**: sequence this after Blocker 1 is closed. Do not attempt to simulate a "successful" transfer as if it were real evidence.

---

## Blocker 5 — Staging/deployment/alerting infrastructure is not yet available

**Status: 🔴 RED**

**Why it matters**: even once Blockers 1-4 are individually resolved, there is currently no persistent staging environment to run a full end-to-end test against, no deployment pipeline to get code there, and no alerting to know if something breaks after go-live.

**Exact dependency/access required**: hosting/infra access (cloud provider account or equivalent) for `core-api`, `voice-orchestrator`, PostgreSQL, Redis; a deployment mechanism (this repo currently has no CI/CD or Dockerfiles to inspect — confirmed absent, not merely undocumented); an alerting provider (PagerDuty/Opsgenie/equivalent — none configured).

**Responsible**: whoever owns infrastructure/DevOps decisions for Ethixweb (business/ops side — this is a genuine "someone needs to choose and pay for a hosting approach" decision, not something to default without you).

**Exact setup steps**: see [docs/34-staging-environment-checklist.md](34-staging-environment-checklist.md) in full — it separates what's required before the first test call from what's required before production.

**Exact test to run**: successful deploy of both services to the staging environment, followed by a health-check pass (`/healthz`, `/readyz` on `voice-orchestrator`; equivalent on `core-api`), followed by [docs/31](31-first-real-phone-call-runbook.md)'s test calls run against the staging URLs instead of local.

**Expected successful result**: both services reachable over HTTPS at stable staging URLs, health checks green, a real call routes through end-to-end.

**Evidence required to mark GREEN**: staging URLs reachable, health-check response bodies captured, at least one full test call executed against staging (not local).

**Current status**: 🔴 no staging environment, deployment pipeline, or alerting exists yet.

**Next action**: decide a hosting approach (this is a business decision — cloud provider, budget, who manages it) — this is the one blocker that has no code-level next step, only a decision-and-provisioning step.

---

## Summary table

| #   | Blocker                     | Status | Owner                   | Cheapest to resolve?                                                   |
| --- | --------------------------- | ------ | ----------------------- | ---------------------------------------------------------------------- |
| 1   | Yash's live runtime         | 🔴 RED | Yash                    | No — requires his runtime code to exist and be reachable               |
| 2   | Live HCP credentials        | 🔴 RED | Business/account owner  | Medium — account provisioning, no code work                            |
| 3   | Real Postgres gate          | 🔴 RED | Anyone with Docker      | **Yes — cheapest, purely infrastructure-access, test already written** |
| 4   | Live SIP/emergency transfer | 🔴 RED | Yash + phone-line owner | No — depends on Blocker 1                                              |
| 5   | Staging/deployment/alerting | 🔴 RED | Infra/DevOps owner      | No — requires a hosting decision                                       |

**Recommended resolution order**: 3 → 2 → 1 → 5 → 4. Reasoning in [docs/35](35-production-go-no-go-gate.md) §J equivalent (also restated in the final report below).
