# Ethixweb AI CSR Platform — Architecture Blueprint

**Status**: Phase 0 blueprint, critically reviewed and revised (see §"What changed on review" below), pending sign-off before repo scaffold begins (see [11-roadmap-risks-future.md](11-roadmap-risks-future.md) §1).
**First deployment**: All Phase Plumbing (tenant #1). **Product intent**: a multi-tenant Ethixweb product for hundreds/thousands of home service companies, not an All-Phase-specific build (see [01-architecture-overview.md](01-architecture-overview.md) §10 for the multi-tenant model this implies from day one).

## Why this exists

Housecall Pro's built-in AI CSR has unresolved problems: dropped calls, dead air, robotic conversation, duplicate customers, jobs booked without human review, and duplicate/confusing notifications. This platform replaces it with one Ethixweb owns end-to-end, designed to integrate with HCP first and ServiceTitan/Jobber/Service Fusion/FieldEdge/future FSMs via a common adapter interface — never coupled to any one CRM's API shape.

## Key decisions already made (see the linked docs for full justification)

| Decision                     | Choice                                                                                                                                              | Doc                                                                                                                      |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Voice/telephony stack        | LiveKit Agents (Node.js), Twilio/Telnyx as pure SIP/PSTN carrier                                                                                    | [02](02-voice-pipeline-and-telephony.md), [20](20-architecture-decision-records.md) ADR-001                              |
| First CRM integration        | Housecall Pro — confirmed to have a genuine `Leads` API object distinct from Jobs, cleanly supporting "AI never schedules"                          | [05](05-crm-integration.md), [20](20-architecture-decision-records.md) ADR-002                                           |
| Backend stack                | NestJS + TypeScript strict, PostgreSQL + Prisma, Redis + BullMQ                                                                                     | [14](14-backend-stack-and-code-standards.md), [20](20-architecture-decision-records.md) ADR-005, ADR-011                 |
| Container orchestration      | **ECS Fargate for Phase 1-2** (revised from an original Kubernetes-first draft — see the reversal below), EKS deferred to an evidence-based trigger | [01](01-architecture-overview.md) §9, [10](10-deployment-cicd.md), [20](20-architecture-decision-records.md) ADR-006     |
| The AI never schedules a job | Enforced architecturally — scheduling tools don't exist in the tool registry, and no CRM adapter contains a code path to a scheduling endpoint      | [04](04-ai-tool-architecture.md) §1, [20](20-architecture-decision-records.md) ADR-003                                   |
| Multi-tenancy                | Shared Postgres schema + Row-Level Security from the first migration                                                                                | [01](01-architecture-overview.md) §10, [06](06-database-schema.md) §1, [20](20-architecture-decision-records.md) ADR-004 |
| Billing                      | Stripe as system of record (no custom billing engine, keeps the platform out of PCI scope)                                                          | [15](15-tenant-lifecycle-billing-and-analytics.md) §3, [20](20-architecture-decision-records.md) ADR-008                 |

## What changed on critical review

This blueprint was reviewed a second time specifically to challenge its own assumptions rather than rubber-stamp the first draft — one load-bearing decision was reversed, and several gaps the original outline didn't ask for were added because a platform sold commercially needs them:

- **Reversed: Kubernetes (EKS) from day one → ECS Fargate for Phase 1-2.** The original justification (custom-metric autoscaling + graceful WebSocket draining "need" Kubernetes) doesn't survive scrutiny — both are native ECS Fargate capabilities. Standing up full cluster operations before a single tenant has validated the product was judged premature operational cost. Full reasoning, and the exact evidence-based conditions under which EKS becomes the right call: [20-architecture-decision-records.md](20-architecture-decision-records.md) ADR-006.
- **Added — not in the original brief, but load-bearing for a real commercial platform**: billing architecture & tenant onboarding/lifecycle ([15](15-tenant-lifecycle-billing-and-analytics.md)), an AI evaluation framework + prompt versioning + feature flags ([16](16-ai-evaluation-prompt-versioning-feature-flags.md)), disaster recovery + multi-region + compliance ([17](17-disaster-recovery-multi-region-compliance.md)), telephony fraud/abuse prevention — specifically toll fraud (IRSF), a well-known and expensive risk category for any platform that can place or transfer calls, which the original brief didn't mention at all ([18](18-abuse-prevention-and-telephony-fraud.md)), concrete operational runbooks ([19](19-operational-runbooks.md)), and a formal ADR log capturing every major decision's alternatives and revisit triggers ([20](20-architecture-decision-records.md)).
- **HCP research resolved the platform's most safety-critical open question**: Housecall Pro's Public API has a genuine, separate `Leads` resource with its own `Convert Lead to Estimate or Job` action and webhook family — confirming `createLead()` maps cleanly with no unscheduled-job workaround needed ([05](05-crm-integration.md) §2.3, §3). It also confirmed HCP does **zero API-level duplicate-customer prevention** (only a manual, irreversible merge tool), which is direct, independent validation that this platform's search-before-create discipline isn't cautious over-engineering — it's the only thing standing between this platform and the exact failure mode it exists to fix.
- **A real gap found on a second review pass, not just restating the first one**: the CRM layer had a rigorous `CRMAdapter` port from the start, but the AI/voice layer didn't — "LiveKit" and "the LLM" were treated as fixed choices in prose, not formal, swappable interfaces. [21-provider-abstraction-and-vendor-risk.md](21-provider-abstraction-and-vendor-risk.md) closes this with `LLMProvider`/`TranscriptionProvider`/`SpeechSynthesisProvider`/`VoiceRuntimeProvider` ports, a full vendor risk register, an explicit 10x/100x scale stress-test, and multi-country expansion considerations — the concrete answer to "support multiple AI providers" and "support multiple telephony providers" over a 5-year horizon.
- **A per-module Design Review was requested; a traceability matrix was built instead, and the reasoning is stated openly in the doc itself**: [22-design-review-traceability-matrix.md](22-design-review-traceability-matrix.md) checks all ten requested dimensions (why/alternatives/failure-modes/security/performance/scalability/cost/extensibility/testing/ops) against every module, points to the existing answer where one already exists, and states a real new one only where a genuine gap was found (10 such gaps, listed in that doc's §2) — rather than duplicating already-argued content into 16 new files that would immediately start drifting from the source of truth.

## Reading order

1. [01-architecture-overview.md](01-architecture-overview.md) — start here. Design principles, all major architecture diagrams, full document map.
2. [02-voice-pipeline-and-telephony.md](02-voice-pipeline-and-telephony.md) — vendor comparison, recommendation, latency budget.
3. [03-conversation-engine.md](03-conversation-engine.md) — prompt design, qualification flow, edge cases.
4. [04-ai-tool-architecture.md](04-ai-tool-architecture.md) — the AI's entire capability surface, tool by tool.
5. [05-crm-integration.md](05-crm-integration.md) — Housecall Pro deep dive (with sourced research), CRM-agnostic adapter pattern.
6. [06-database-schema.md](06-database-schema.md) — ER diagram, DDL notes, multi-tenant indexing/retention.
7. [07-notification-and-emergency.md](07-notification-and-emergency.md) — consolidated notifications, lead claiming, emergency escalation.
8. [08-security-observability-reliability.md](08-security-observability-reliability.md) — security, OTel, resilience patterns.
9. [09-cost-analysis.md](09-cost-analysis.md) — cost model at 100/500/1,000/10,000 calls/day, optimization levers.
10. [10-deployment-cicd.md](10-deployment-cicd.md) — environments, pipeline, blue/green deploy, IaC.
11. [11-roadmap-risks-future.md](11-roadmap-risks-future.md) — phased plan, risks/mitigations, future roadmap.
12. [12-production-readiness-checklist.md](12-production-readiness-checklist.md) — go-live gate.
13. [13-implementation-backlog.md](13-implementation-backlog.md) — per-module task breakdown.
14. [14-backend-stack-and-code-standards.md](14-backend-stack-and-code-standards.md) — stack rationale, Hexagonal Architecture, SOLID, testing strategy.
15. [15-tenant-lifecycle-billing-and-analytics.md](15-tenant-lifecycle-billing-and-analytics.md) — onboarding, tenant lifecycle, billing, analytics.
16. [16-ai-evaluation-prompt-versioning-feature-flags.md](16-ai-evaluation-prompt-versioning-feature-flags.md) — eval framework, prompt versioning, feature flags.
17. [17-disaster-recovery-multi-region-compliance.md](17-disaster-recovery-multi-region-compliance.md) — DR objectives, multi-region strategy, compliance posture.
18. [18-abuse-prevention-and-telephony-fraud.md](18-abuse-prevention-and-telephony-fraud.md) — toll fraud, robocall abuse, SIP security.
19. [19-operational-runbooks.md](19-operational-runbooks.md) — concrete incident runbooks and recurring operational cadence.
20. [20-architecture-decision-records.md](20-architecture-decision-records.md) — every major decision's alternatives, trade-offs, and revisit triggers. This is a living document — new decisions and reversals are appended here, never edited into old entries.
21. [21-provider-abstraction-and-vendor-risk.md](21-provider-abstraction-and-vendor-risk.md) — LLM/STT/TTS/voice-runtime provider ports, vendor risk register, 10x/100x scale stress-test, multi-country considerations.
22. [22-design-review-traceability-matrix.md](22-design-review-traceability-matrix.md) — per-module design-review coverage (why/alternatives/failure-modes/security/performance/scalability/cost/extensibility/testing/ops), gaps closed inline.
23. [23-phase7-emergency-notification-sequences.md](23-phase7-emergency-notification-sequences.md) — as-built sequence diagrams for emergency escalation, notification fan-out, and the Dead Letter Queue redrive path.
24. [24-runtime-orchestrator-contract.md](24-runtime-orchestrator-contract.md) — as-built Voice Runtime ↔ Orchestrator HTTP contract (Phase 8), turn-idempotency requirements, and the concrete checklist for wiring up a live runtime.
25. [25-service-credential-provisioning.md](25-service-credential-provisioning.md) — the exact HTTP call to mint voice-orchestrator's core-api service API key.

## What's not yet decided (open items requiring your sign-off before Phase 0 repo scaffold)

- Confirm the LiveKit + Twilio/Telnyx voice stack recommendation ([02](02-voice-pipeline-and-telephony.md), [20](20-architecture-decision-records.md) ADR-001), given its honest trade-off (untuned latency needs real engineering to hit sub-1s, and LiveKit Cloud's recent uptime trailed its own SLA).
- Confirm the Fargate-first reversal ([20](20-architecture-decision-records.md) ADR-006) — this is a meaningful change from a "just use Kubernetes" default and worth an explicit yes rather than an assumed one, given how much of Phase 1's DevOps setup depends on it.
- Housecall Pro integration has **7 must-verify-before-build items** that cannot be resolved from public documentation and need a live HCP sandbox account or a direct conversation with Housecall Pro — listed in full in [05-crm-integration.md](05-crm-integration.md) §2.9, most notably whether this integration authenticates via the simple Admin API key or requires OAuth2/the separate "Partner Jobs API." Recommend resolving this specific item before the `crm-integration` module's first sprint, since it shapes the adapter's auth design.
- Confirm the Phase 1 tool set (6 tools, [11](11-roadmap-risks-future.md) §1) is sufficient for All Phase's pilot, or if anything should move earlier/later.
- Sign off on the cost model assumptions in [09-cost-analysis.md](09-cost-analysis.md) (4-minute average call) against All Phase's actual expected call pattern once known.
- Confirm the billing approach (Stripe, [15](15-tenant-lifecycle-billing-and-analytics.md) §3) and plan-tier structure before onboarding flow work begins, since plan gating touches the feature-flag design in [16](16-ai-evaluation-prompt-versioning-feature-flags.md) §4.3.

Once these are confirmed, next step is Phase 0 repo scaffold per [13-implementation-backlog.md](13-implementation-backlog.md) "Cross-module / platform-level tasks."
