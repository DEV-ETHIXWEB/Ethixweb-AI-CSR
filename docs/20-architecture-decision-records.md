# 20 — Architecture Decision Records

Format: Context → Decision → Alternatives considered and rejected (with why) → Trade-offs accepted → Status → Revisit trigger. This is the audit trail a principal engineer reviewing this blueprint should be able to check every major call against — not just "what was decided" but "what else was on the table and why it lost," so a future reviewer with new evidence can reopen a decision on its actual merits instead of relitigating from scratch.

---

## ADR-001: Voice/telephony stack — LiveKit Agents + Twilio/Telnyx as SIP carrier

**Context**: the single most latency-critical, most vendor-dependent layer in the platform. Full comparison in [02-voice-pipeline-and-telephony.md](02-voice-pipeline-and-telephony.md).

**Decision**: LiveKit Agents (`agents-js`, Node.js) as the conversational agent runtime, on LiveKit Cloud initially with self-hosting as a defined future option, fronted by Twilio or Telnyx purely as the SIP/PSTN carrier.

**Alternatives rejected**:

- _Retell AI / Vapi (fully-managed voice-agent platforms)_ — faster to a demo, but lock the platform into a proprietary turn-taking engine (Retell) or proprietary orchestration config (Vapi). Rejected because this platform is meant to be a long-lived, owned Ethixweb product, not a wrapper around another vendor's roadmap — the exact complaint driving the whole project's existence against Housecall Pro's own AI.
- _OpenAI Realtime API as the whole voice layer_ — most expensive per-minute uncached, no telephony/transfer story of its own, and had four service disruptions in four days in the research window (late July 2026) with no swappable fallback since the speech-to-speech format is proprietary. Rejected as the _voice_ layer; not rejected as an available _text-LLM_ choice behind a separate STT/TTS pipeline, which stays swappable via the LLM Gateway.
- _Daily/Pipecat_ — Pipecat's server framework is Python-only; running the platform's most complex, most latency-critical service in a different language/runtime than the rest of the Node/TypeScript backend was judged an unforced cost with no offsetting benefit.
- _Twilio ConversationRelay as the whole stack_ — excellent, but its turn-management protocol is proprietary to Twilio. Retained Twilio/Telnyx in the carrier role specifically (a standards-based, portable role it's excellent at) rather than the agent-brain role.

**Trade-offs accepted**: LiveKit's neutral/untuned benchmark latency was mid-pack, not fastest — hitting the sub-1-second target requires real tuning engineering, not a config default. LiveKit Cloud's recent 30-day uptime (97.22%) trailed its own SLA. Both are treated as inputs to the reliability architecture ([08](08-security-observability-reliability.md) §3) and the voice-outage runbook ([19-operational-runbooks.md](19-operational-runbooks.md) §2), not ignored.

**Status**: Accepted, pending final sign-off per [00-INDEX.md](00-INDEX.md).

**Revisit trigger**: if LiveKit Cloud's measured uptime in Phase 1 production meaningfully underperforms the researched 97.22% figure, or if the sub-1-second latency target proves unreachable after a real tuning effort (not just default config).

---

## ADR-002: CRM-agnostic Hexagonal adapter pattern, Housecall Pro as first implementation

**Context**: the platform must eventually support multiple FSM/CRM platforms without rewriting business logic per integration. Full design in [05-crm-integration.md](05-crm-integration.md), [14-backend-stack-and-code-standards.md](14-backend-stack-and-code-standards.md) §2.

**Decision**: a `CRMAdapter` port defined in the domain layer; all business logic depends on the interface, never on a concrete CRM SDK.

**Alternatives rejected**: building directly against the Housecall Pro SDK/API shape in the service layer, with future CRMs handled by conditional branches (`if (crmType === 'hcp')`). Rejected because it would make every new CRM an increasingly invasive change to already-working code, the opposite of the Open/Closed principle this codebase is built around.

**Trade-offs accepted**: more upfront abstraction/interface design work before any CRM integration is "done," and a risk (mitigated by contract tests, [10-deployment-cicd.md](10-deployment-cicd.md) §2) that the interface is designed around HCP's specific shape and turns out not to generalize once a second CRM (with a fundamentally different API style, e.g. Jobber's GraphQL vs. HCP's REST) is actually implemented.

**Status**: Accepted. Directly validated by the HCP research ([05](05-crm-integration.md) §2.3) confirming HCP's own `Leads` object maps cleanly onto the interface's `createLead()` without a workaround — the interface's core assumption (a lead-vs-job distinction exists or can be modeled) held.

**Revisit trigger**: if the second real CRM adapter (Phase 2, [11-roadmap-risks-future.md](11-roadmap-risks-future.md)) requires a breaking change to the `CRMAdapter` interface rather than an additive one, the interface's shape needs re-examination before a third adapter is attempted.

---

## ADR-003: "AI never schedules" enforced as capability absence, not prompt instruction

**Context**: the platform's core safety requirement. Full design in [04-ai-tool-architecture.md](04-ai-tool-architecture.md) §1.

**Decision**: no scheduling/dispatch tool exists in the tool broker's registry, and `HcpAdapter` (and every future CRM adapter) contains no code path capable of calling a scheduling/dispatch endpoint, regardless of what the LLM is told to do.

**Alternatives rejected**: relying on prompt instructions ("never schedule a job") as the sole control, optionally combined with an LLM-based output classifier checking for scheduling intent after the fact. Rejected because prompt instructions are not a security boundary against a sufficiently adversarial or simply confused caller (prompt injection via spoken caller input is a real, not hypothetical, attack surface for any LLM-driven phone system), and a post-hoc classifier is a detection control, not a prevention control — it can catch a violation after it already happened.

**Trade-offs accepted**: less flexibility — if a future legitimate use case genuinely needs the AI to touch scheduling (not currently planned, and would require significant product/liability reconsideration), it's a deliberate architecture change, not a config flag.

**Status**: Accepted, foundational — this is treated as close to immutable as any decision in the blueprint.

**Revisit trigger**: none anticipated; would require a fundamental product-scope change (e.g. a tenant-opt-in "AI can book jobs" tier) explicitly decided at the business level, not an engineering judgment call.

---

## ADR-004: Multi-tenancy via shared schema + Postgres Row-Level Security

**Context**: full design in [06-database-schema.md](06-database-schema.md) §1, [01-architecture-overview.md](01-architecture-overview.md) §10.

**Decision**: single shared Postgres schema, `tenant_id` on every tenant-scoped table, RLS policies enforced at the database layer from the first migration.

**Alternatives rejected**: schema-per-tenant or database-per-tenant for stronger isolation. Rejected because it multiplies migration operational complexity linearly with tenant count (running a migration against a thousand tenant schemas is a materially different operational problem than one), and complicates the platform-internal analytics ([15-tenant-lifecycle-billing-and-analytics.md](15-tenant-lifecycle-billing-and-analytics.md) §4) that needs cross-tenant aggregate queries.

**Trade-offs accepted**: a noisy-neighbor tenant shares database capacity with others (mitigated by per-tenant rate limiting, not compute isolation); a catastrophic RLS policy bug is a cross-tenant data leak (mitigated by RLS being applied from the first migration rather than retrofitted, and by the isolation-boundary test in [12-production-readiness-checklist.md](12-production-readiness-checklist.md)).

**Status**: Accepted.

**Revisit trigger**: a specific enterprise tenant's contractual requirement for physically isolated infrastructure (not just logical RLS isolation) — addressed as a dedicated DB-per-large-tenant option without a schema rewrite, per [06](06-database-schema.md) §1's note that the schema is already designed to support this without retrofitting.

---

## ADR-005: NestJS + TypeScript strict + Prisma + PostgreSQL

**Context**: full rationale in [14-backend-stack-and-code-standards.md](14-backend-stack-and-code-standards.md) §1.

**Decision**: NestJS as the Core API framework (on Fastify adapter), Prisma as the ORM, PostgreSQL as the primary store.

**Alternatives rejected**:

- _Plain Fastify + a lighter routing layer (no NestJS)_ — less framework overhead and a shallower learning curve, but loses NestJS's DI container and module system, which is what makes the Hexagonal Architecture boundary ([14](14-backend-stack-and-code-standards.md) §2) enforceable by the framework rather than by convention alone (an `eslint-plugin-boundaries` rule is a weaker guarantee than a DI container that can only wire in what a module explicitly exports).
- _Kysely or a raw SQL query builder instead of Prisma_ — better fit for advanced RLS/partitioning patterns Prisma doesn't model natively ([06-database-schema.md](06-database-schema.md) §2's documented gap), and worth reconsidering if that gap causes real friction, but Prisma's compile-time type safety between schema and query code was judged worth the RLS/partitioning workaround (raw SQL migrations alongside Prisma's own) for a team this size.

**Trade-offs accepted**: Prisma's RLS/declarative-partitioning gap means those specific pieces of schema management are hand-written SQL migrations outside Prisma's own tooling — an explicit, documented seam, not a silent one.

**Status**: Accepted.

**Revisit trigger**: if the Prisma/RLS friction becomes a recurring source of migration bugs in practice (tracked via incident postmortems, [19-operational-runbooks.md](19-operational-runbooks.md) §1), reconsider Kysely specifically for the tables with the most complex RLS/partitioning needs, rather than a wholesale ORM swap.

---

## ADR-006: ECS Fargate for Phase 1-2, Kubernetes (EKS) deferred to an evidence-based trigger

**Context**: this is a genuine reversal from an earlier draft of [01-architecture-overview.md](01-architecture-overview.md) §9, made during a critical-review pass rather than accepted as originally specified. Full reasoning in [01](01-architecture-overview.md) §9, procedural detail in [10-deployment-cicd.md](10-deployment-cicd.md).

**Decision**: ECS Fargate as the container orchestration platform for Phase 1-2, with EKS as a defined future migration, not a default starting point.

**Original assumption (rejected on review)**: "Kubernetes because the voice-orchestrator needs custom-metric autoscaling and graceful connection draining, and HPA/PodDisruptionBudgets are first-class in k8s." **Why this was wrong as a _starting_ justification**: both requirements are achievable natively on ECS Fargate (Application Auto Scaling custom-metric target-tracking; `deploymentConfiguration` + application-level `SIGTERM` handling for drain) at meaningfully lower operational overhead — cluster upgrades, IAM-for-service-accounts, a Prometheus-adapter for custom metrics, and Helm chart maintenance are all real, ongoing costs that a pre-PMF, small-team Phase 1 pilot should not pay before the product has proven itself. The original justification conflated "Kubernetes can do this well" (true) with "only Kubernetes can do this" (false).

**Trade-offs accepted by choosing Fargate first**: less flexibility for future workload-colocation patterns (sidecars, service mesh, a self-hosted LiveKit SFU with specialized networking/GPU needs), smaller ecosystem of off-the-shelf operators.

**Status**: Accepted (revised).

**Revisit trigger** (explicit, evidence-based, not calendar-based — any one of): (1) self-hosting the LiveKit SFU for cost control at volume ([09-cost-analysis.md](09-cost-analysis.md) §4) requires infrastructure patterns Fargate can't express cleanly; (2) the team grows enough to have a dedicated platform/DevOps engineer who can own cluster operations as their primary job; (3) mTLS service mesh becomes a genuine compliance requirement (e.g. driven by the SOC 2 push in [17-disaster-recovery-multi-region-compliance.md](17-disaster-recovery-multi-region-compliance.md) §3) rather than a nice-to-have. Because the application containers don't call Fargate-specific APIs directly, this migration is infrastructure/Terraform+Helm work, not an application rewrite.

---

## ADR-007: Redis Streams for the event bus now; Kafka/NATS as a later option, not a default

**Context**: full design in [01-architecture-overview.md](01-architecture-overview.md) §5.

**Decision**: outbox pattern publishing to Redis Streams with consumer groups, since Redis is already mandatory infrastructure (cache, BullMQ, session state).

**Alternatives rejected**: Kafka or NATS JetStream from day one. Rejected for the same "don't pay for operational complexity before it's earned" reasoning as ADR-006 — at even the 10,000-calls/day cost model's event volume, Redis Streams' ordering/replay/consumer-group guarantees are sufficient, and standing up a second messaging system alongside Redis (already required) has no offsetting benefit yet.

**Trade-offs accepted, stated more honestly than the original draft**: migrating the outbox relay's publish target later is _not_ purely "a one-file change" as originally, optimistically stated — consumer offset/acknowledgment semantics differ meaningfully between Redis Streams' consumer groups and Kafka's/NATS's own models, so a future migration is a real, scoped project (rewriting consumer offset-tracking logic), even though it doesn't require touching event producers or the domain/application layers, which only depend on the outbox abstraction.

**Status**: Accepted, with the honesty correction above.

**Revisit trigger**: sustained event throughput or retention requirements (e.g. long-term event replay for analytics, [15-tenant-lifecycle-billing-and-analytics.md](15-tenant-lifecycle-billing-and-analytics.md) §4) that Redis Streams' memory-bound retention model can't reasonably serve.

---

## ADR-008: Stripe for billing; no custom billing engine

**Context**: full design in [15-tenant-lifecycle-billing-and-analytics.md](15-tenant-lifecycle-billing-and-analytics.md) §3.

**Decision**: Stripe Billing as the system of record for subscriptions, usage-based metering, invoicing, tax, and dunning; this platform's own tables mirror Stripe's state via webhooks.

**Alternatives rejected**: a custom billing engine. Rejected outright — billing touches PCI scope, tax jurisdiction rules, and payment-retry logic, none of which is this platform's differentiated value, and building it in-house is a well-known source of both compliance risk and wasted engineering effort relative to buying a solved problem.

**Trade-offs accepted**: less flexibility for exotic pricing models than a fully custom engine would allow; a dependency on Stripe's own reliability and API stability for a business-critical function.

**Status**: Accepted.

**Revisit trigger**: none anticipated at any scale this platform is realistically planning for — this is one of the few decisions expected to remain correct indefinitely.

---

## ADR-009: Self-built feature flags (Postgres + Redis cache), not a third-party flagging SaaS

**Context**: full design in [16-ai-evaluation-prompt-versioning-feature-flags.md](16-ai-evaluation-prompt-versioning-feature-flags.md) §4.

**Decision**: a small, self-built flag-evaluation service using infrastructure (Postgres, Redis) already mandatory for the rest of the platform.

**Alternatives rejected**: LaunchDarkly or a similar vendor. Not rejected on principle — reconsidered as a live option once flag-evaluation needs grow (multivariate experiments, statistical A/B significance testing) beyond simple percentage/attribute targeting, which is exactly the targeting model the platform's own tenant/business/plan-tier data already expresses.

**Trade-offs accepted**: no vendor-provided experimentation statistics tooling, no polished non-engineer-facing flag-management UI out of the box (the admin dashboard has to build this itself).

**Status**: Accepted.

**Revisit trigger**: flag-evaluation logic outgrowing simple percentage/attribute targeting, or a non-engineering team member needing to manage experiments without engineering involvement at a frequency that justifies a dedicated tool.

---

## ADR-010: Outbound-calling features deferred to Phase 4, not built alongside inbound

**Context**: full reasoning in [11-roadmap-risks-future.md](11-roadmap-risks-future.md) §1, compliance detail in [17-disaster-recovery-multi-region-compliance.md](17-disaster-recovery-multi-region-compliance.md) §3.

**Decision**: no outbound-calling capability (callback confirmation calls, review-request calls/texts to end customers) until a dedicated Phase 4 compliance project.

**Alternatives rejected**: building outbound callback confirmation alongside the inbound-qualification MVP, since it seems like a natural adjacent feature. Rejected because TCPA (consent capture, do-not-call list checking, calling-hours restrictions) is a distinct legal/compliance surface that has nothing to do with the inbound-qualification problem this platform launches to solve, and bolting it on early would either delay the actual launch-critical work or ship an under-compliant outbound feature.

**Trade-offs accepted**: a real, requested-sounding feature (automated callback confirmations) isn't available at launch.

**Status**: Accepted.

**Revisit trigger**: dedicated Phase 4 scoping once the inbound product is validated and a TCPA compliance review is resourced as its own project.

---

## ADR-011: BullMQ on Redis for job queues, not SQS/EventBridge

**Context**: full design in [14-backend-stack-and-code-standards.md](14-backend-stack-and-code-standards.md) §1.

**Decision**: BullMQ, backed by the Redis instance already required for caching/session state.

**Alternatives rejected**: AWS SQS + EventBridge (more "cloud-native," fully managed). Rejected because it introduces a second queueing paradigm and a second piece of infrastructure to operate and monitor, when Redis is already mandatory — BullMQ's job-ID-based deduplication is also directly exploited for the "one notification per lead" guarantee ([07-notification-and-emergency.md](07-notification-and-emergency.md) §2) in a way that requires more manual plumbing (an explicit dedup table) to replicate on SQS.

**Trade-offs accepted**: Redis-backed queues are memory-bound and require the operator to manage Redis persistence/durability carefully (AOF) for queue durability, versus SQS's fully-managed durability guarantees.

**Status**: Accepted.

**Revisit trigger**: queue durability incidents traced to Redis persistence configuration, or event/job volume outgrowing a single Redis cluster's reasonable capacity.

---

## ADR-012: AI evaluation combines automated rubric checks, LLM-as-judge, and human sampling — not any single method alone

**Context**: full design in [16-ai-evaluation-prompt-versioning-feature-flags.md](16-ai-evaluation-prompt-versioning-feature-flags.md) §2.

**Decision**: a layered eval approach — deterministic/automated checks wherever a dimension can be checked without a model (field extraction, scheduling/pricing-promise detection, closing-script presence), LLM-as-judge only for genuinely subjective dimensions (robotic-tic detection, brand-voice compliance), and ongoing human QA sampling as a check on judge drift.

**Alternatives rejected**: pure LLM-as-judge for all dimensions (faster to build, but vulnerable to judge drift and shared blind spots with the model being judged, especially same-vendor); pure human review (the only fully trustworthy signal, but doesn't scale to a CI gate that needs to run on every prompt-config PR).

**Trade-offs accepted**: more eval-harness engineering work upfront to build the deterministic checks, versus just writing an LLM-judge prompt and calling it done.

**Status**: Accepted.

**Revisit trigger**: a sustained, measured divergence between judge-model scores and human QA scores on the same call sample — the explicit signal named in [16](16-ai-evaluation-prompt-versioning-feature-flags.md) §2.1 as worth alerting on, not just background monitoring.

---

## ADR-013: Denormalize `tenant_id` onto every tenant-scoped table, not just tables with a direct `business_id` FK

**Context**: found during Phase 0 implementation, translating [06-database-schema.md](06-database-schema.md) into a real Prisma schema. That doc's prose (§0 intro) states "every tenant-scoped table has a `tenant_id uuid NOT NULL`," but its own ER diagram only lists `tenant_id` on `CUSTOMERS`, `CALLS`, `LEADS`, and `AUDIT_LOGS` — every other business-scoped table (`INTEGRATIONS`, `AGENT_CONFIGS`, `EMERGENCY_RULES`, `BUSINESS_HOURS`, `ONCALL_ROTATIONS`, `NOTIFICATION_CHANNELS`, `WEBHOOK_SUBSCRIPTIONS`, `WEBHOOK_DELIVERIES`, `NOTIFICATIONS`, `CRM_SYNC_LOG`, `VOICE_SESSIONS`, `TRANSCRIPTS`, `TOOL_CALLS`) carries only `business_id`. Writing real RLS policies against the ER diagram as drawn would have meant two different enforcement mechanisms for the same isolation guarantee — a direct `tenant_id = current_setting(...)` predicate on four tables, and a slower `business_id IN (SELECT id FROM businesses WHERE tenant_id = current_setting(...))` subquery-join predicate on every other table — which is exactly the kind of inconsistency an external security auditor would flag as two separately-reasoned-about controls instead of one.

**Decision**: every tenant-scoped table gets its own `tenant_id` column, denormalized from the owning `business.tenant_id` at write time, so every RLS policy in the schema is the identical simple predicate: `USING (tenant_id = current_setting('app.tenant_id')::uuid)`. This is what the doc's own prose already claimed and is exactly the Supabase-style pattern [06](06-database-schema.md) §2 cites as the model being followed — the ER diagram, not the prose, was the stale artifact here.

**Alternatives rejected**: subquery-join RLS policies through `business_id` (matches the ER diagram literally, but is slower per-row at scale, and contradicts both the doc's own prose and its cited best-practice pattern) — rejected in favor of resolving the conflict toward the documented intent rather than the unreviewed diagram.

**Trade-offs accepted**: minor storage redundancy (`tenant_id` duplicated across parent and child tables) and a new invariant the application layer must uphold — `tenant_id` is always derived from the authenticated business context server-side, never accepted as separate client input, so the denormalized copy can't drift from the owning business's real tenant. Enforced at the repository layer (every insert on a child table takes `businessId` and looks up/carries its `tenantId`, never accepts a caller-supplied `tenantId` directly).

**Status**: Accepted. `packages/database/prisma/schema.prisma` implements this; [06-database-schema.md](06-database-schema.md)'s ER diagram should be treated as superseded on this point by this ADR until the doc itself is next revised.

**Revisit trigger**: none anticipated — this is a correctness fix aligning implementation with already-stated intent, not a new trade-off to reconsider later.

---

## ADR-014: RLS tenant context set via transaction-scoped `set_config`, not a bare per-connection `SET`

**Context**: found during Phase 0 implementation of `apps/core-api`'s Prisma integration. [06-database-schema.md](06-database-schema.md) §1 describes the RLS session variable as "set by the connection middleware at the start of every request/call session" — accurate as a mental model, but underspecified in a way that would have been actively unsafe if implemented literally: a plain `SET app.tenant_id = ...` on a connection from a pooled client (which is exactly how Prisma/PgBouncer-style pooling works) can leak that value to the _next_ request that happens to reuse the same physical connection before the variable is reset — precisely the cross-tenant leak RLS exists to prevent, self-inflicted by the middleware meant to enforce it.

**Decision**: `TenantContextService.run(tenantId, work)` (`apps/core-api/src/shared/prisma/tenant-context.service.ts`) wraps every tenant-scoped repository call in a Prisma interactive transaction (`$transaction`) and sets the session variable via `SELECT set_config('app.tenant_id', $1, true)` — the third argument (`is_local => true`) is the RLS-safe equivalent of `SET LOCAL`, automatically scoped to that transaction and guaranteed to reset on commit or rollback regardless of connection reuse. Every tenant-scoped repository method signature takes the resulting `Prisma.TransactionClient`, never the raw `PrismaService`, so there is no code path that can accidentally query a tenant-scoped table outside this wrapper.

**Alternatives rejected**: a bare `SET app.tenant_id` executed by request middleware directly against the pooled connection (unsafe under connection reuse, as above); an application-layer-only `WHERE tenant_id = ?` on every query with no RLS at all (rejected previously and for the same reason in [ADR-004](#adr-004-multi-tenancy-via-shared-schema--postgresql-row-level-security) — this would silently reduce "defense in depth" to "defense in one layer," exactly the bug class RLS is meant to catch).

**Trade-offs accepted**: every tenant-scoped repository call now runs inside an explicit transaction even for single-statement reads, a small overhead versus a bare query — judged acceptable given the safety guarantee, and consistent with this platform's willingness to pay a small, well-understood cost for structural correctness over an application-layer-only convention (the same trade-off [ADR-004](#adr-004-multi-tenancy-via-shared-schema--postgresql-row-level-security) already made).

**Status**: Accepted. Implemented in `apps/core-api/src/shared/prisma/tenant-context.service.ts`.

**Revisit trigger**: if per-request transaction overhead is ever measured as a real latency contributor on a hot path (unlikely for `core-api`'s CRUD-shaped endpoints; would matter more if this pattern were ever reused inside the voice-orchestrator's turn-taking loop, which it should not be — that service's tenant scoping happens once at call start, not per conversation turn).

---

## ADR-015: `api_keys` authentication lookup via a narrow `SECURITY DEFINER` function, not a blanket RLS exemption

**Context**: found while building the `auth` module's API-key authentication path. Every tenant-scoped table's RLS policy (ADR-013/ADR-014) requires `app.tenant_id` to already be set — but a caller authenticating _with_ an API key doesn't know their own `tenant_id` yet; resolving it is the entire purpose of the lookup. The same structural problem `tenants` has (ADR-013 exempts it from RLS entirely, since it's the identity root, not a scoped resource) recurs here, but `api_keys` is different from `tenants` in one important way: `api_keys` also has a second, completely normal access pattern — an authenticated tenant admin listing/creating/revoking their _own_ tenant's keys — which should stay exactly as RLS-protected as every other resource. A blanket RLS exemption (the `tenants`-style fix) would correctly solve the authentication-time lookup but would incorrectly also remove RLS's defense-in-depth from the management operations, which have no structural reason to need that exemption.

**Decision**: keep the standard `tenant_isolation` RLS policy on `api_keys` for all normal access, and add one additional, narrowly-scoped `SECURITY DEFINER` SQL function, `lookup_api_key_for_auth(key_hash)`, callable only by `app_runtime`, that runs with the table owner's privileges (bypassing RLS) but is fixed to: an exact `key_hash` equality match, returning only `(id, tenant_id, scopes, revoked_at, expires_at)` — never the `key_hash` column itself, never an arbitrary filter. `SET search_path = public` is set explicitly inside the function to close the standard search-path-hijacking attack against `SECURITY DEFINER` functions. This is the one code path in the entire schema permitted to read `api_keys` without tenant context already established; every other access goes through the normal RLS-protected policy.

**Alternatives rejected**:

- Blanket RLS exemption on `api_keys` (the `tenants`/`webhook_events`/`outbox_events` pattern) — rejected because it would also strip RLS's defense-in-depth from tenant-scoped management operations (list/create/revoke a tenant's own keys) that have no structural need for an exemption, unlike the pure-identity-root `tenants` table.
- Running the lookup as the migration/owner role from application code — rejected as a clear least-privilege violation: that role can do arbitrary DDL and unrestricted DML, and mixing owner-role usage into a live request-handling path (however narrow the intended query) contradicts the entire two-role security model ADR-013/ADR-014 exists to enforce.

**Trade-offs accepted**: one `SECURITY DEFINER` function is a real, if narrow, RLS bypass surface that needs its own scrutiny in any future security review — mitigated by its fixed, minimal signature (no dynamic SQL, no caller-supplied filter beyond the exact hash) and by `REVOKE ALL ... FROM PUBLIC` plus an explicit, single `GRANT EXECUTE ... TO app_runtime`.

**Status**: Accepted. Implemented in `packages/database/prisma/migrations/00000000000002_rls_policies/migration.sql`.

**Revisit trigger**: if a future credential type needs the same pre-tenant-context lookup pattern (e.g., a webhook-inbound API token), reuse this exact function shape rather than inventing a new bypass mechanism per credential type.
