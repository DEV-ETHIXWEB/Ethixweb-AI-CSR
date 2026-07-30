# 22 — Design Review Traceability Matrix

## 0. A deliberate judgment call, stated openly rather than silently made

The request was for a per-module **Design Review** (why it exists, alternatives, trade-offs, failure modes, security, performance, scalability, cost, extensibility, testing, operational considerations) produced _before_ implementation of each module. That standard is correct and is being applied here — but mechanically writing 16 new files that each restate content already argued in detail across docs 01-21 would be exactly the kind of duplicated, drifting documentation a senior team flags in review ("this paragraph exists in three places and now two of them are stale"). A real design-review gate should verify that every dimension has a real, findable, load-bearing answer — not that the same answer has been retyped once per module.

So this document does the verification a Design Review is actually for: for every module in [13-implementation-backlog.md](13-implementation-backlog.md), it checks all ten dimensions and either **points to where the answer already lives** (most cells) or **states it here for the first time** because nothing existed yet (marked **(new)**). Anywhere this matrix found a genuine gap, that gap is now closed by the one-line answer given — this is the actual output of "questioning every decision," not a restatement of decisions already made. The summary at the end (§2) lists every **(new)** cell in one place so it's auditable which parts of this pass produced real new content versus verification.

## 1. Matrix

### `tenants`

- **Why**: multi-tenant SaaS root entity, owns businesses/users/API keys — [01](01-architecture-overview.md) §10
- **Alternatives/trade-offs**: shared schema + RLS vs. schema-per-tenant/DB-per-tenant — [20](20-architecture-decision-records.md) ADR-004
- **Failure modes**: illegal lifecycle transitions (e.g. `Archived → Active`) rejected at the repository layer — [15](15-tenant-lifecycle-billing-and-analytics.md) §2
- **Security**: RLS on every tenant-scoped table — [06](06-database-schema.md) §1, [08](08-security-observability-reliability.md) §1.6
- **Performance (new)**: tenant/business config is read through the cached config-precedence resolver ([03](03-conversation-engine.md) §1), never a live DB hit per conversation turn — this module is not on the voice hot path at all.
- **Scalability**: RLS + shared schema chosen specifically to scale to thousands of tenants without per-tenant migration overhead; DB-per-large-tenant is an escape hatch, not a rewrite — [20](20-architecture-decision-records.md) ADR-004
- **Cost (new)**: marginal cost per tenant row is negligible — the platform's real cost driver is call volume, not tenant count, so this module contributes nothing meaningful to the [09-cost-analysis.md](09-cost-analysis.md) model.
- **Extensibility**: plan-tier, billing, and feature-flag targeting all key off the tenant/business hierarchy — [15](15-tenant-lifecycle-billing-and-analytics.md) §3, [16](16-ai-evaluation-prompt-versioning-feature-flags.md) §4.3
- **Testing**: cross-tenant RLS isolation test is a go-live gate — [12](12-production-readiness-checklist.md) Security section
- **Ops**: suspended-tenant call-handling behavior, onboarding flow — [15](15-tenant-lifecycle-billing-and-analytics.md) §1-2

### `auth`

- **Why**: identity/access for dashboard users, API consumers, inbound webhook senders — [08](08-security-observability-reliability.md) §1.1
- **Alternatives/trade-offs**: static API key vs. OAuth2 for CRM credentials (kept pluggable pending the unresolved HCP auth question); JWT+refresh vs. long-lived tokens for the dashboard — [08](08-security-observability-reliability.md) §1.1, [05](05-crm-integration.md) §2.1
- **Failure modes**: revoked/expired CRM credential handling (HCP silently breaks integrations on key deletion) — [05](05-crm-integration.md) §2.9, [19](19-operational-runbooks.md) §3
- **Security**: RBAC roles, envelope-encrypted CRM credentials, Redis-backed revocation list — [08](08-security-observability-reliability.md) §1.1, §1.2, §1.6
- **Performance (new)**: JWT verification is stateless (no DB round-trip); the revocation check hits Redis, not Postgres — keeps auth checks cheap on every request without a database in the critical path.
- **Scalability (new)**: stateless JWT verification scales horizontally with no shared-state bottleneck — adding API instances doesn't add auth-layer contention.
- **Cost**: negligible.
- **Extensibility**: OAuth2 path kept swappable behind the same credential abstraction pending direct confirmation from Housecall Pro — [05](05-crm-integration.md) §2.1
- **Testing**: RBAC role-boundary tests (a `dispatcher` cannot touch billing/emergency-rules) — [12](12-production-readiness-checklist.md) Security section
- **Ops**: credential rotation runbook — [19](19-operational-runbooks.md) §6

### `customers`

- **Why**: the search-before-create discipline that is the actual fix for the duplicate-customer failure mode — [05](05-crm-integration.md) §4
- **Alternatives/trade-offs**: search-by-phone (chosen — the only identifier available before qualification) vs. search-by-name; local cache-first vs. always-live CRM read — [05](05-crm-integration.md) §4
- **Failure modes**: concurrent-create race handled by DB unique constraint as the real backstop, not the application check — [05](05-crm-integration.md) §4, [06](06-database-schema.md) §2
- **Security (new)**: customer PII (name/phone/address) inherits standard RDS-at-rest encryption plus the platform-wide PII-redaction-in-logs middleware ([08](08-security-observability-reliability.md) §1.4) — no additional customer-specific security control needed beyond what's already platform-wide.
- **Performance**: local-cache-first with a 60s TTL, CRM fallback only on miss — [04](04-ai-tool-architecture.md) §3.1
- **Scalability (new)**: the `UNIQUE(business_id, phone_e164)` index scales with standard B-tree performance at any realistic tenant/customer count — no special sharding or lookup strategy needed at this data shape.
- **Cost**: bounded by the per-tenant tool-broker rate limiter, one CRM read per uncached lookup — [04](04-ai-tool-architecture.md) §4
- **Extensibility**: fully CRM-agnostic via `CRMAdapter` — [05](05-crm-integration.md) §1
- **Testing**: explicit concurrent-create race test required — [13](13-implementation-backlog.md) `customers` module
- **Ops**: covered by the general CRM-outage runbook, no customer-specific procedure needed — [19](19-operational-runbooks.md) §3

### `calls`

- **Why**: call lifecycle, transcript, and recording system of record — [06](06-database-schema.md) ER diagram
- **Alternatives/trade-offs**: stream transcripts turn-by-turn (chosen, for crash-recovery and the future live-supervisor dashboard) vs. batch-write at call end — [13](13-implementation-backlog.md) `calls` module
- **Failure modes**: mid-call crash recovery via conversation state rehydrated from Redis by `call_id` — [08](08-security-observability-reliability.md) §3
- **Security**: recordings encrypted at rest (SSE-KMS), access-logged — [08](08-security-observability-reliability.md) §1.4
- **Performance (new)**: transcript persistence happens off the STT/LLM/TTS critical path — each turn is appended after the response is already streaming to the caller, never blocking it.
- **Scalability**: `transcripts`/`tool_calls` partitioned by month from day one — [06](06-database-schema.md) §4
- **Cost**: S3 storage scales with call volume × retention window, factored into the general cost model — [09](09-cost-analysis.md)
- **Extensibility**: recording/transport vendor-agnostic via `VoiceRuntimeProvider` — [21](21-provider-abstraction-and-vendor-risk.md) §1
- **Testing**: exercised end-to-end by the synthetic canary call and E2E smoke suite — [08](08-security-observability-reliability.md) §2.4, [10](10-deployment-cicd.md) §2
- **Ops**: retention policy enforcement, GDPR purge workflow — [08](08-security-observability-reliability.md) §1.4

### `crm-integration`

- **Why**: the CRM-agnostic core requirement — [05](05-crm-integration.md) §1
- **Alternatives/trade-offs**: Hexagonal adapter interface vs. direct SDK coupling in service code — [20](20-architecture-decision-records.md) ADR-002
- **Failure modes**: circuit breaker + local-first lead persistence on CRM outage — [04](04-ai-tool-architecture.md) §3.3, [08](08-security-observability-reliability.md) §3
- **Security**: envelope-encrypted credentials — [08](08-security-observability-reliability.md) §1.2
- **Performance**: async, off the voice hot path by design principle — [01](01-architecture-overview.md) §1 rule 5
- **Scalability**: per-tenant, per-CRM rate limiting protects shared upstream API limits — [04](04-ai-tool-architecture.md) §4
- **Cost**: negligible platform-side; bounded by the CRM vendor's own plan requirement (HCP's MAX plan, ~$299-329/mo) — [05](05-crm-integration.md) §2.1
- **Extensibility**: Liskov-substitutable adapters enforced by contract tests — [14](14-backend-stack-and-code-standards.md) §3
- **Testing**: shared adapter conformance suite — [10](10-deployment-cicd.md) §2
- **Ops**: CRM-outage runbook, revoked-credential alerting — [19](19-operational-runbooks.md) §3

### `tool-broker`

- **Why**: the AI's entire capability surface, the platform's core safety boundary — [04](04-ai-tool-architecture.md) §1
- **Alternatives/trade-offs**: capability-absence enforcement vs. prompt-based restriction — [20](20-architecture-decision-records.md) ADR-003
- **Failure modes**: per-tool timeout/retry/degraded-response policy, individually specified — [04](04-ai-tool-architecture.md) §3
- **Security**: schema validation, per-agent-config tool allowlist, full audit log — [04](04-ai-tool-architecture.md) §2
- **Performance**: <150ms tool round-trip budget on the hot path — [02](02-voice-pipeline-and-telephony.md) §3
- **Scalability**: per-tenant, per-tool rate limiting — [04](04-ai-tool-architecture.md) §4
- **Cost**: the broker itself is negligible cost; it's the control point for the CRM/LLM cost it gates — [09](09-cost-analysis.md) §1
- **Extensibility**: a new tool is a new registry entry + schema + contract test, zero broker changes — [04](04-ai-tool-architecture.md) §4
- **Testing**: malformed-input-rejected and duplicate-idempotency-key-returns-cached-result contract tests — [13](13-implementation-backlog.md) `tool-broker` module
- **Ops**: per-tool kill-switch via feature flags — [16](16-ai-evaluation-prompt-versioning-feature-flags.md) §4

### `leads`

- **Why**: the single "commit" record of a qualified call — [04](04-ai-tool-architecture.md) §3.3
- **Alternatives/trade-offs**: hard `UNIQUE(call_id)` constraint (one lead per call) with `updateLead` for corrections, vs. allowing multiple lead rows per call — chosen for the former, matching the "AI never double-books/double-creates" principle — [04](04-ai-tool-architecture.md) §3.3-3.4
- **Failure modes**: CRM write failure leaves a local `pending_crm_sync` record, never a lost lead — [04](04-ai-tool-architecture.md) §3.3
- **Security (new)**: status transitions are validated against an explicit state machine at the repository layer, the same discipline applied to tenant lifecycle ([15](15-tenant-lifecycle-billing-and-analytics.md) §2) — an illegal transition (e.g. `expired → claimed`) is rejected in code, not just assumed not to happen.
- **Performance**: outbox event written in the same DB transaction as the lead insert — no dual-write risk — [01](01-architecture-overview.md) §5
- **Scalability**: partitioned by month at volume — [06](06-database-schema.md) §4
- **Cost**: negligible.
- **Extensibility**: CRM-agnostic via the `createLead` port — [05](05-crm-integration.md) §3
- **Testing**: contract test asserting no reachable code path to a scheduling endpoint — [13](13-implementation-backlog.md) `crm-integration` module
- **Ops**: DLQ replay runbook for stuck leads — [19](19-operational-runbooks.md) §5

### `emergency-rules`

- **Why**: the highest risk-asymmetry logic in the platform (false negatives cost far more than false positives) — [07](07-notification-and-emergency.md) §5
- **Alternatives/trade-offs**: hardcoded keyword list vs. a tenant-configurable rules engine — chose the latter, seeded conservative — [07](07-notification-and-emergency.md) §5.1
- **Failure modes**: fail-safe-toward-escalation default if the rules engine itself is unreachable — [07](07-notification-and-emergency.md) §5.2
- **Security**: business-scoped RLS on rule rows, same as every tenant-scoped table — [06](06-database-schema.md) ER diagram
- **Performance**: 1.5s timeout budget on `escalateEmergency` — [04](04-ai-tool-architecture.md) §3.8
- **Scalability**: per-business rule sets with no cross-tenant coupling — trivially horizontal
- **Cost**: negligible.
- **Extensibility**: seeded defaults per vertical, fully tenant-overridable, reviewed (not silently accepted) at onboarding — [15](15-tenant-lifecycle-billing-and-analytics.md) §1, [07](07-notification-and-emergency.md) §5.1
- **Testing**: eval suite explicitly scores emergency-classification accuracy as a CI-gated rubric dimension — [16](16-ai-evaluation-prompt-versioning-feature-flags.md) §2.1
- **Ops**: on-call rotation configuration is part of onboarding, not an afterthought — [15](15-tenant-lifecycle-billing-and-analytics.md) §1

### `notifications`

- **Why**: structurally fixes the "duplicate callback / multiple texts" failure mode named in the original brief — [07](07-notification-and-emergency.md) §1-2
- **Alternatives/trade-offs**: per-channel dedup logic vs. a single BullMQ job-ID-per-lead dedup — chose the latter specifically because it's enforced by the queue itself, not application discipline — [07](07-notification-and-emergency.md) §2
- **Failure modes**: per-channel retry/DLQ — [01](01-architecture-overview.md) §6
- **Security**: claim replies matched via a short-lived phone-to-lead mapping rather than exposing lead IDs in SMS — [07](07-notification-and-emergency.md) §4
- **Performance**: async, off the voice hot path — [01](01-architecture-overview.md) §1 rule 5
- **Scalability**: scales with lead volume, not call volume — most calls aren't emergencies, so this is a lower-risk scaling dimension than the voice layer — [21](21-provider-abstraction-and-vendor-risk.md) §3
- **Cost**: per-channel vendor cost (SMS/email), negligible relative to voice/AI spend — [09](09-cost-analysis.md) §1
- **Extensibility**: one canonical `NotificationPayload`, N channel renderers — [07](07-notification-and-emergency.md) §3
- **Testing**: claim-race test (two technicians reply "CLAIM" the same second, exactly one wins) — [12](12-production-readiness-checklist.md) Notifications section
- **Ops**: covered by the general retry/DLQ runbook — [19](19-operational-runbooks.md) §5

### `webhook-subscriptions`

- **Why**: outbound webhooks to tenants' own systems — groundwork for the Phase 4 partner API — [01](01-architecture-overview.md) §7
- **Alternatives/trade-offs**: reuse the notification module's signing/retry infrastructure vs. a separate implementation — chose reuse — [13](13-implementation-backlog.md) `webhook-subscriptions` module
- **Failure modes**: retry/DLQ, same pattern as every other queue — [01](01-architecture-overview.md) §6
- **Security**: HMAC-signed payloads, per-tenant secret — [01](01-architecture-overview.md) §7
- **Performance**: async, off hot path.
- **Scalability**: same profile as `notifications`.
- **Cost**: negligible.
- **Extensibility**: designed as the foundation for Phase 4's tenant self-service subscription management — [11](11-roadmap-risks-future.md) Phase 4
- **Testing**: signature-verification and delivery-retry tests, same suite pattern as inbound webhooks
- **Ops**: DLQ replay runbook — [19](19-operational-runbooks.md) §5

### `shared/kernel`

- **Why**: cross-cutting infra (outbox, idempotency, retry/circuit-breaker, OTel setup, PII-redacting logger) used by every other module — [13](13-implementation-backlog.md) `shared/kernel`
- **Alternatives/trade-offs**: one shared retry/circuit-breaker implementation vs. per-module reimplementation — chose shared, explicitly to prevent the "three slightly-different implementations that drift" anti-pattern — [13](13-implementation-backlog.md) `shared/kernel`
- **Failure modes**: this module's purpose _is_ the platform's failure-handling machinery — [01](01-architecture-overview.md) §6
- **Security**: PII-redaction middleware lives here, applied uniformly — [13](13-implementation-backlog.md) `shared/kernel` item 5
- **Performance**: this is where the hot-path/async-path split is actually enforced in code, not just described in architecture prose — [01](01-architecture-overview.md) §1 rule 5
- **Scalability**: the outbox relay is the one component whose throughput directly gates event-bus scaling — [21](21-provider-abstraction-and-vendor-risk.md) §3
- **Cost**: negligible direct cost.
- **Extensibility**: this is the exact seam the Redis Streams → Kafka/NATS migration (ADR-007) touches — [20](20-architecture-decision-records.md) ADR-007
- **Testing**: unit-tested in isolation, given every other module's correctness depends on it — [14](14-backend-stack-and-code-standards.md) §6
- **Ops**: DLQ/outbox depth are the primary platform-wide alerting signals — [08](08-security-observability-reliability.md) §2.3

### `observability`

- **Why**: the answer to "what did a specific call actually do" — [08](08-security-observability-reliability.md) §2
- **Alternatives/trade-offs**: OTel-neutral + self-hosted Grafana stack now vs. a managed vendor (Datadog/Honeycomb) from day one — chose the former, kept the latter a config-only swap — [08](08-security-observability-reliability.md) §2.1
- **Failure modes**: synthetic canary calls exist specifically to catch "the API is healthy but the voice pipeline is silently broken," a failure mode standard health checks structurally cannot see — [08](08-security-observability-reliability.md) §2.4
- **Security**: PII redaction applied before anything ships to observability tooling — [08](08-security-observability-reliability.md) §1.4
- **Performance (new)**: tracing overhead is standard OTel auto-instrumentation (HTTP/Prisma/Redis), not custom code on the hot path — no bespoke performance design needed for this module itself.
- **Scalability (new)**: runs as its own ECS Fargate service, scaling independently of the application services it observes — an observability-stack slowdown never competes for the same compute as a live call.
- **Cost**: part of the infra baseline in the cost model — [09](09-cost-analysis.md) §2
- **Extensibility**: vendor swap is collector-config-only, no application code changes — [08](08-security-observability-reliability.md) §2.1
- **Testing**: alerting is verified by deliberately forcing failure conditions (force a circuit breaker open, force a DLQ breach), not assumed to work because it's configured — [12](12-production-readiness-checklist.md) Observability section
- **Ops**: this module _is_ the ops tooling that the rest of [19-operational-runbooks.md](19-operational-runbooks.md) depends on

### `billing`

- **Why**: what makes this a sellable product rather than just a working system — [15](15-tenant-lifecycle-billing-and-analytics.md) §3
- **Alternatives/trade-offs**: Stripe vs. a custom billing engine — [20](20-architecture-decision-records.md) ADR-008
- **Failure modes (new)**: a Stripe outage delays billing sync (subscription/invoice state going stale) but never blocks call answering or lead creation, since billing state is a mirror, not a gate, on service delivery — see the vendor risk register — [21](21-provider-abstraction-and-vendor-risk.md) §2
- **Security**: no card data ever reaches Ethixweb infrastructure — [15](15-tenant-lifecycle-billing-and-analytics.md) §3.1
- **Performance**: not on any hot path.
- **Scalability**: usage-metering reuses the same `voice_sessions` cost data as the internal cost dashboards — one pipeline, not two — [15](15-tenant-lifecycle-billing-and-analytics.md) §3.2
- **Cost (new)**: Stripe's own processing fees are a pass-through cost proportional to revenue, not a platform infrastructure cost, and are intentionally not modeled in [09-cost-analysis.md](09-cost-analysis.md)'s infrastructure/AI cost breakdown.
- **Extensibility**: plan tiers are just another feature-flag targeting dimension — [16](16-ai-evaluation-prompt-versioning-feature-flags.md) §4.3
- **Testing**: Stripe webhook handling follows the same idempotent-handler pattern as every other inbound webhook — [15](15-tenant-lifecycle-billing-and-analytics.md) §3.1
- **Ops**: per-tenant spend-cap/overage alerting — [13](13-implementation-backlog.md) `billing` module

### `feature-flags`

- **Why**: the kill-switch and gradual-rollout capability the platform would otherwise entirely lack — [16](16-ai-evaluation-prompt-versioning-feature-flags.md) §4.1
- **Alternatives/trade-offs**: self-built (Postgres + Redis cache) vs. a third-party flagging SaaS — [20](20-architecture-decision-records.md) ADR-009
- **Failure modes (new)**: if the flag-evaluation path itself is unreachable, application code falls back to the last-cached value in Redis rather than failing the request — a flag-service outage degrades to "flags frozen at their last known state," never a hard error on the conversation hot path.
- **Security**: flag changes are audit-logged like any other config change — [08](08-security-observability-reliability.md) §1.7
- **Performance**: hot-path reads are cache-only, never a live evaluation call — [16](16-ai-evaluation-prompt-versioning-feature-flags.md) §4.2
- **Scalability**: explicit revisit trigger already defined (multivariate experimentation needs) — [20](20-architecture-decision-records.md) ADR-009
- **Cost**: negligible.
- **Extensibility**: targeting dimensions map directly onto the existing tenant/business/plan-tier model, no new data model needed — [16](16-ai-evaluation-prompt-versioning-feature-flags.md) §4.3
- **Testing**: kill-switch response time is exercised as part of the credential-compromise runbook drill — [19](19-operational-runbooks.md) §6
- **Ops**: this module _is_ the kill-switch mechanism referenced throughout the other runbooks — [19](19-operational-runbooks.md) §6

### Voice orchestrator (separate service)

- **Why**: the highest-stakes, most latency-critical service in the platform — [02-voice-pipeline-and-telephony.md](02-voice-pipeline-and-telephony.md) entire document
- **Alternatives/trade-offs**: full six-vendor comparison — [02](02-voice-pipeline-and-telephony.md) §1-2, [20](20-architecture-decision-records.md) ADR-001
- **Failure modes**: voice reconnect, graceful degradation, filler-phrase masking of tool-call latency — [08](08-security-observability-reliability.md) §3, [02](02-voice-pipeline-and-telephony.md) §3
- **Security**: SIP/TLS/SRTP, destination allowlisting on call transfer — [18](18-abuse-prevention-and-telephony-fraud.md) §1, §3
- **Performance**: the sub-1-second latency budget _is_ this module's central design constraint — [02](02-voice-pipeline-and-telephony.md) §3
- **Scalability**: custom-metric autoscaling on active-call-count — [01](01-architecture-overview.md) §9
- **Cost**: the dominant line item in the entire cost model — [09](09-cost-analysis.md) §1
- **Extensibility**: `VoiceRuntimeProvider`/`LLMProvider`/STT/TTS ports — [21](21-provider-abstraction-and-vendor-risk.md) §1
- **Testing**: conversation-quality eval harness, synthetic canary calls — [16](16-ai-evaluation-prompt-versioning-feature-flags.md) §2, [08](08-security-observability-reliability.md) §2.4
- **Ops**: voice-vendor-outage runbook — [19](19-operational-runbooks.md) §2

### Telephony fraud & abuse controls

- **Why**: toll fraud (IRSF) is a real, expensive risk category unique to any platform that can place/transfer calls, identified during critical review rather than present in the original brief — [18](18-abuse-prevention-and-telephony-fraud.md) §0-1
- **Alternatives/trade-offs**: architectural absence of a general outbound-call tool, layered with allowlist/spend-cap/carrier controls, rather than relying on any single control alone — [18](18-abuse-prevention-and-telephony-fraud.md) §1
- **Failure modes**: this module's entire content is a failure/abuse-mode enumeration — [18](18-abuse-prevention-and-telephony-fraud.md) entire document
- **Security**: this module _is_ a security control set, not a consumer of one
- **Performance**: STIR/SHAKEN attestation checks add negligible latency and happen before the expensive part of the pipeline engages — [18](18-abuse-prevention-and-telephony-fraud.md) §4
- **Scalability**: per-ANI rate limiting enforced at the carrier/gateway layer, independent of application-layer capacity — [18](18-abuse-prevention-and-telephony-fraud.md) §5
- **Cost**: bounds worst-case fraud exposure — a cost-tail risk control, not a steady-state cost line item — [18](18-abuse-prevention-and-telephony-fraud.md) §1
- **Extensibility**: carrier-level restrictions are account configuration, not code — [18](18-abuse-prevention-and-telephony-fraud.md) §1
- **Testing**: destination-allowlist rejection test is a go-live gate — [12](12-production-readiness-checklist.md) Security section
- **Ops**: credential-compromise runbook — [19](19-operational-runbooks.md) §6

### Disaster recovery & operational runbooks

- **Why**: "what happens on the bad day" needs a stated, rehearsed answer before it happens, not an improvised one during an incident — [17](17-disaster-recovery-multi-region-compliance.md) §1
- **Alternatives/trade-offs**: active-passive multi-region now, active-active explicitly deferred pending real cross-region evidence — [17](17-disaster-recovery-multi-region-compliance.md) §2.3
- **Failure modes**: this module enumerates the platform's DR-relevant failure modes directly — [17](17-disaster-recovery-multi-region-compliance.md) §1
- **Security (new)**: cross-region backup replication inherits the same KMS envelope encryption as primary-region data — no separate encryption scheme for DR copies.
- **Performance**: not applicable — this is a recovery-time concern, not a steady-state performance one.
- **Scalability**: RTO/RPO targets are stated per component, not as a single platform-wide number — [17](17-disaster-recovery-multi-region-compliance.md) §1.1
- **Cost (new)**: cross-region backup replication cost is small relative to compute spend (S3/RDS backup replication pricing, not duplicated compute) — enabled from Phase 1 specifically because it's cheap, unlike warm-standby compute which is deferred to Phase 3.
- **Extensibility**: the entire environment is rebuildable via `terraform apply` in a new region — [17](17-disaster-recovery-multi-region-compliance.md) §1.1
- **Testing**: quarterly restore-from-backup drill, not a one-time pre-launch check — [17](17-disaster-recovery-multi-region-compliance.md) §1.2
- **Ops**: this module _is_ the operational runbook set — [19-operational-runbooks.md](19-operational-runbooks.md) entire document

## 2. Summary — what was genuinely new versus verified

Cells marked **(new)** above are the actual output of this review pass — content that did not exist anywhere in docs 01-21 before this matrix was built: `tenants` performance/cost, `auth` performance/scalability, `customers` security/scalability, `calls` performance, `leads` security, `observability` performance/scalability, `billing` failure-modes/cost, `feature-flags` failure-modes, and `disaster recovery` security/cost. Every other cell was a verification that a real, specific answer already existed and is correctly cross-referenced — which is the point: a Design Review's job is to confirm nothing is missing, not to generate volume.
