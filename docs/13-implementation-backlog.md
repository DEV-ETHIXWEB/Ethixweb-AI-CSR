# 13 — Detailed Implementation Backlog by Module

Maps to the module structure in [14-backend-stack-and-code-standards.md](14-backend-stack-and-code-standards.md) §5. Each module's tasks are ordered; later tasks generally depend on earlier ones within the same module. This is the Phase 1 backlog (see [11-roadmap-risks-future.md](11-roadmap-risks-future.md)) unless marked otherwise.

## `tenants` module

1. Prisma schema + migration for `tenants`, `businesses`, `users`, `api_keys` (see [06](06-database-schema.md)).
2. RLS policy migrations for every tenant-scoped table (raw SQL, applied alongside Prisma migrations).
3. Tenant/business CRUD service + REST endpoints, RBAC-guarded.
4. Config precedence resolver (platform default → tenant default → business override → runtime) as a shared, testable service used by every other module that reads config — not duplicated per module.
5. Admin dashboard: tenant/business settings pages (Phase 2 for full self-service; Phase 1 needs only enough to configure the pilot tenant, can be seeded via migration/seed script).

## `auth` module

1. JWT issuance/refresh, httpOnly cookie handling, Redis-backed revocation list.
2. API key generation/hashing/scoping/revocation.
3. RBAC guard + decorator (`@Roles('admin')`) integrated with NestJS's guard pipeline.
4. Tenant-context middleware: resolves authenticated principal's `tenant_id`, sets the Postgres session variable RLS depends on, for every request.
5. Webhook signature verification utility (HMAC), shared across all inbound webhook handlers.

## `customers` module

1. `CustomerRepository` interface + Prisma implementation.
2. Phone-number normalization to E.164 (shared utility, used before any phone-based lookup/write).
3. `searchCustomer` use case: local cache check → CRM adapter search → cache write-back.
4. `createCustomer` use case: CRM adapter create → local unique-constraint race handling (catch constraint violation, re-fetch, return existing) → cache write-back.
5. Unit tests covering the concurrent-create race explicitly (two simultaneous `createCustomer` calls for the same phone number).

## `calls` module

1. `Call`, `VoiceSession`, `Transcript` Prisma models + repositories.
2. Call lifecycle service: call started/ended webhooks from the voice orchestrator, status transitions.
3. Transcript persistence (append-only, streamed from the orchestrator as turns complete, not batched at call-end only — needed for the real-time supervisor dashboard in the future roadmap and for mid-call crash recovery).
4. Recording upload pipeline (LiveKit egress → S3, encrypted, linked to `calls.recording_url`).
5. Call detail API (for the future admin dashboard's per-call view: transcript, tool calls made, latency metrics).

## `crm-integration` module

0. **First task, blocking everything else in this module**: resolve the 7 must-verify-before-build items against a live HCP sandbox account ([05-crm-integration.md](05-crm-integration.md) §2.9) — auth model, phone-search parameter, `Create Lead` schema, Lead note/tag support, webhook signature header, rate limits, pagination. Writing the adapter against unverified assumptions here is the single highest-risk starting point in this whole module.
1. `CRMAdapter` interface (and narrower `CustomerPort`/`LeadPort`/`NotePort` per [14](14-backend-stack-and-code-standards.md) §3) defined in the domain layer.
2. Shared adapter conformance test suite (contract tests, [10](10-deployment-cicd.md) §2) — including an explicit test asserting `createLead()` has no reachable code path to any job-creation/scheduling endpoint, per the contract stated in [05](05-crm-integration.md) §3.
3. `HousecallProAdapter`: auth flow (per task 0's resolved answer), `searchCustomer` (`GET /customers`, phone filter per task 0), `createCustomer` (`POST /customers`), `createLead` (`POST /leads` — confirmed to be HCP's genuine, separate Lead object, not a workaround, per [05-crm-integration.md](05-crm-integration.md) §2.3), note/transcript attachment (on the resulting Job via `Add job note` once converted, or inline on the Lead if task 0 confirms that field exists), webhook receiver for `lead.created`/`lead.converted`/`lead.lost` events (signature header per task 0).
4. Credential encryption/storage integration (envelope encryption via KMS, per [08](08-security-observability-reliability.md) §1.2).
5. `CrmSyncLog` write on every adapter operation (audit trail independent of the tool broker's own `tool_calls` log — this one specifically tracks CRM-side sync state for the retry/DLQ workflow).
6. Circuit breaker wrapper around every adapter method, configured per-tenant.
7. Stub adapter interfaces for ServiceTitan/Jobber/Service Fusion/FieldEdge (interface + a "not yet implemented" throwing stub) — proves the interface is genuinely CRM-agnostic before a second real implementation is built in Phase 2.

## `tool-broker` module

1. Tool registry: schema (Zod) + handler binding for each tool in [04-ai-tool-architecture.md](04-ai-tool-architecture.md) §3.
2. Broker pipeline: validation → authorization (agent-config allowlist) → idempotency check (Redis, keyed per §3 tables) → timeout wrapper → execute → audit write.
3. Per-tool timeout/retry configuration, loaded from the tool registry's declared policy (not hardcoded per call site).
4. `tool_calls` audit persistence.
5. Rate limiter integration (per-tenant token bucket, Redis).
6. Contract tests: malformed input rejected before execution; unauthorized tool call rejected; duplicate idempotency key returns cached result without re-executing.

## `leads` module

1. `Lead`, `LeadClaim` Prisma models + repositories, including the `UNIQUE(call_id)` constraint.
2. `createLead`/`updateLead` use cases (invoked by the tool broker, not directly by controllers).
3. Outbox event write (`lead.created`) in the same transaction as the lead insert.
4. Lead status state machine (`new → notified → claimed → converted_to_job | expired | duplicate`) as an explicit, tested transition function, not scattered `status = 'x'` assignments.
5. `converted_to_job` webhook handler (from the CRM adapter's webhook receiver, closes the loop once a human actually schedules).
6. Lead inbox API (list/filter by status/priority, for the dispatcher-facing dashboard).

## `emergency-rules` module

1. `EmergencyRule`, `BusinessHours`, `OnCallRotation`, `OnCallShift` Prisma models + repositories.
2. Rule-matching engine (`escalateEmergency` use case): keyword/pattern match → severity → action, with the fail-safe-toward-escalation default on any internal error.
3. Business-hours/holiday-calendar evaluation service (`getBusinessHours` use case).
4. On-call rotation resolver: given a business + timestamp, resolve the active shift; round-robin/simultaneous-ring fallback logic for no-answer.
5. Seed data/migration for the default emergency keyword set (§5.1 table in [07](07-notification-and-emergency.md)), tagged as tenant-editable defaults, not hardcoded.
6. Admin dashboard CRUD for emergency rules, business hours, on-call rotations (Phase 2 for full self-service UI; Phase 1 can be config-file/seed-script driven for the pilot tenant).

## `notifications` module

1. `NotificationChannel`, `Notification` Prisma models + repositories.
2. Consolidated `NotificationPayload` data model + per-channel renderers (SMS/email/Slack/Teams/webhook).
3. Notification worker (BullMQ processor, job ID = `lead_id` for built-in dedup).
4. Channel senders: Twilio SMS, SMTP/SES email, Slack webhook, Teams webhook, generic outbound webhook (reuses the outbound webhook signing/delivery/retry infra built for the `webhook-subscriptions` piece below).
5. Inbound SMS-reply webhook handler ("CLAIM" parsing) + the atomic compare-and-set claim logic ([07](07-notification-and-emergency.md) §4).
6. Push notification channel (Phase 2+, once a mobile/PWA dashboard exists to receive them).

## `webhook-subscriptions` module (outbound webhooks to tenants' own systems)

1. `WebhookSubscription`, `WebhookDelivery` Prisma models + repositories.
2. Signing (HMAC-SHA256 + timestamp) and delivery service, reused by the notifications module's generic-webhook channel.
3. Retry/backoff/DLQ wiring (shared retry utility from `shared/kernel`, not reimplemented per module).
4. Subscription management API (tenant self-service: register a URL, choose event types).

## `shared/kernel` (cross-cutting infra used by every module above — build this early, not last)

1. Outbox pattern implementation: transactional write helper + relay worker (polls `outbox_events`, publishes to Redis Streams, marks dispatched).
2. Idempotency key utilities (generation convention, Redis-backed dedup check, TTL policy).
3. Generic retry/backoff/circuit-breaker utility, parameterized (used by CRM adapters, notification senders, webhook delivery — one implementation, not three).
4. OTel instrumentation setup (tracer/meter providers, auto-instrumentation for HTTP/Prisma/Redis, custom span attribute injection for `tenant_id`/`call_id`).
5. Structured logging with PII-redaction middleware.

## `observability` module

1. OTel Collector deployment config + Grafana stack (Tempo/Loki/Prometheus) provisioning (Terraform, see [10](10-deployment-cicd.md) §5).
2. Custom metrics: voice latency histograms, per-call token/cost counters, business metrics (leads/claims/escalations per business per day).
3. Dashboards: latency SLO, cost-per-call, cost-anomaly, notification delivery success rate, DLQ depth.
4. Alerting rules (per [08](08-security-observability-reliability.md) §2.3) wired to PagerDuty/Slack.
5. Synthetic canary call scheduler + assertion suite.

## Voice orchestrator (separate service, not a NestJS module — see [14](14-backend-stack-and-code-standards.md) stack table)

1. LiveKit Agents (`agents-js`) project scaffold, SIP trunk integration (Twilio/Telnyx).
2. Streaming STT integration, VAD/turn-detector configuration and tuning per [02](02-voice-pipeline-and-telephony.md) §3.
3. LLM Gateway: model routing, prompt assembly from layered config ([03](03-conversation-engine.md) §1), streaming tool-call parsing, prompt caching for the static system-prompt portion.
4. Streaming TTS integration, sentence-level chunking.
5. Conversation state machine implementation ([03](03-conversation-engine.md) §2) as explicit, tested transition logic — not implicit in prompt text.
6. Filler-phrase injection for tool calls expected to exceed ~400ms ([02](02-voice-pipeline-and-telephony.md) §3).
7. Call transfer execution (`WarmTransferTask` / cold SIP REFER) triggered by `escalateEmergency`'s returned action.
8. Voice reconnect handling (WebSocket/room disconnect recovery, conversation state rehydrated from Redis by `call_id`).
9. Blue/green deploy support: graceful drain on shutdown signal, readiness gate that only accepts new calls when fully healthy.
10. Conversation quality eval harness ([14](14-backend-stack-and-code-standards.md) §6): scripted persona transcripts run against the assembled prompt + LLM, scored against the no-robotic-tics/correct-extraction/correct-emergency-classification rubric, gating prompt-config changes in CI.

## `feature-flags` module (Phase 2, but the evaluation client library should exist before Phase 1's prompt-canary needs it)

1. Flag definition schema + admin CRUD (Postgres-backed, per [16](16-ai-evaluation-prompt-versioning-feature-flags.md) §4.2).
2. Redis-cached evaluation client with short TTL, designed for the hot-path latency constraint (no live network call inside a conversation turn).
3. Targeting logic: global/tenant/business/plan-tier/percentage-hash-on-call-id (§4.3 in the same doc).
4. Admin-dashboard flag management UI (Phase 2).

## `billing` module (Phase 2)

1. Stripe integration: subscription creation on tenant activation, webhook receiver for Stripe events (same signature-verification + idempotent-handler pattern as every other inbound webhook, [01](01-architecture-overview.md) §7).
2. Usage-metering pipeline: derive metered usage from `voice_sessions` duration/cost data and report to Stripe's usage-based billing API — one pipeline feeding both this and the internal cost dashboard ([15](15-tenant-lifecycle-billing-and-analytics.md) §3.2), not two.
3. Plan-tier → feature-flag mapping (plan gating is a flag-targeting dimension, not a separate access-control system, per [16](16-ai-evaluation-prompt-versioning-feature-flags.md) §4.3).
4. Per-tenant spend cap / overage alerting, sharing the cost-anomaly alerting infrastructure from [08](08-security-observability-reliability.md) §2.3.
5. Tenant lifecycle state machine (`Trial → Active → PastDue → Suspended → Offboarding → Archived`, [15](15-tenant-lifecycle-billing-and-analytics.md) §2) enforced at the repository layer against illegal transitions.

## Telephony fraud & abuse controls (spans `tool-broker`, `crm-integration`/carrier config, and infra — not a single module)

1. Destination allowlist enforcement in the call-transfer tool implementation, validated against `oncall_shifts`/business config immediately before dialing ([18](18-abuse-prevention-and-telephony-fraud.md) §1) — built alongside the transfer feature itself in Phase 1, not after.
2. Carrier-account configuration: disable international/premium-rate destination classes, enable vendor-native fraud detection (Twilio/Telnyx account settings, [18](18-abuse-prevention-and-telephony-fraud.md) §1).
3. Per-tenant outbound-transfer-minutes/day cap at the tool-broker rate limiter ([04](04-ai-tool-architecture.md) §4, [18](18-abuse-prevention-and-telephony-fraud.md) §1).
4. Destination-anomaly cost alerting (extends [08](08-security-observability-reliability.md) §2.3's cost-anomaly alerting with a destination-pattern dimension).
5. SIP trunk IP allowlisting, TLS/SRTP enforcement, failed-auth monitoring ([18](18-abuse-prevention-and-telephony-fraud.md) §3) — infra/Terraform-level, done once during Phase 0/1 carrier setup.
6. STIR/SHAKEN attestation check + per-ANI rate limiting at the carrier/gateway layer ([18](18-abuse-prevention-and-telephony-fraud.md) §4).

## Disaster recovery & operational runbooks (infra + process, tracked here so it isn't forgotten as "someone will document it later")

1. Cross-region RDS/S3 backup replication enabled from Phase 1 ([17](17-disaster-recovery-multi-region-compliance.md) §1.2).
2. Quarterly restore-from-backup drill scheduled and run at least once before Phase 1 go-live (a [12-production-readiness-checklist.md](12-production-readiness-checklist.md) gate item).
3. Write and rehearse the runbooks in [19-operational-runbooks.md](19-operational-runbooks.md) — specifically the voice-vendor-outage carrier-level fallback routing (§2), which needs actual pre-configuration per tenant, not just a written procedure.
4. Incident severity/response process ([19](19-operational-runbooks.md) §1) adopted by whoever is on call from Phase 1, not introduced later once an incident has already happened without one.

## Cross-module / platform-level tasks

1. Repo scaffold: NestJS monorepo (Nx or Turborepo — evaluate at Phase 0 kickoff), shared `tsconfig`/`eslint` config with the `eslint-plugin-boundaries` Hexagonal-layer enforcement rule ([14](14-backend-stack-and-code-standards.md) §7).
2. Docker Compose local environment (Postgres, Redis, mock CRM adapter server, mock voice-vendor sandbox where feasible).
3. CI pipeline (GitHub Actions) per [10-deployment-cicd.md](10-deployment-cicd.md) §2, including the AI eval CI gate ([16](16-ai-evaluation-prompt-versioning-feature-flags.md) §2.2).
4. Terraform modules for all AWS infra ([10](10-deployment-cicd.md) §5).
5. ECS task/service definitions (via Terraform) for all deployments, parameterized per environment — Helm charts only become relevant if/when the EKS migration trigger in [20-architecture-decision-records.md](20-architecture-decision-records.md) ADR-006 fires.
6. Seed script for Phase 1 pilot tenant (All Phase Plumbing) config: business hours, emergency rules, notification channels, agent prompt config.
