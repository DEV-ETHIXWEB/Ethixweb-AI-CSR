# 12 — Production Readiness Checklist

Gate before any tenant's real inbound line is routed to this platform (Phase 1 exit criteria referenced in [11-roadmap-risks-future.md](11-roadmap-risks-future.md)).

## Voice quality

- [ ] p95 time-to-first-response-audio under 1.2s measured against real (not synthetic-only) test calls, across at least 3 different network conditions/devices
- [ ] Barge-in/interruption tested and confirmed to cancel in-flight TTS within one turn, no "as I was saying" artifacts
- [ ] Silence-recovery prompts fire correctly at configured thresholds, escalate to voicemail after exhausted attempts, never loop indefinitely
- [ ] Closing script confirmed to play in full on every call-ending path (normal close, transfer, voicemail, abandoned)
- [ ] Conversation quality eval suite ([14](14-backend-stack-and-code-standards.md) §6) passing against the rubric: no robotic full-sentence-readback tics, correct name-spelling behavior (only spells uncommon/low-confidence names), no scheduling/pricing promises

## Data integrity

- [ ] Duplicate-customer prevention verified under concurrent-call load test (same number calling twice within a race window)
- [ ] `leads.call_id` unique constraint verified — cannot create two leads from one call
- [ ] CRM outage simulated (adapter mocked to fail) — confirmed call completes normally, lead persists locally, background sync retries and eventually succeeds once CRM recovers
- [ ] Idempotency keys verified on all write tools — replaying a tool call with the same key does not double-create

## Emergency handling

- [ ] Full seeded emergency keyword set reviewed and approved by the pilot tenant (All Phase Plumbing) for their specific vocabulary/vertical
- [ ] Fail-safe-toward-escalation behavior verified when the rules engine is artificially made unreachable
- [ ] On-call rotation transfer tested end-to-end (business hours, after-hours, holiday calendar paths) with a real phone ringing
- [ ] Escalation path verified to never dead-end — voicemail + notification fallback confirmed reachable even when every on-call attempt fails

## Notifications

- [ ] Exactly one consolidated notification per lead verified (no duplicate SMS/email/Slack messages from a single lead-creation event)
- [ ] Claim mechanism race-tested (two recipients replying "CLAIM" within the same second — exactly one succeeds, other gets "already claimed")
- [ ] All configured channels (SMS/email/Slack/Teams/webhook) verified to receive matching content, correctly formatted per channel
- [ ] Notification delivery failure triggers retry per [01-architecture-overview.md](01-architecture-overview.md) §6, and failures visible in the admin dashboard, not silent

## Security

- [ ] Row-Level Security policies verified on every tenant-scoped table (attempted cross-tenant query test, confirmed blocked at the DB layer, not just the app layer)
- [ ] All inbound webhooks (CRM, telephony, SMS-reply) verified to reject invalid/missing signatures
- [ ] Call-transfer destination allowlisting verified (attempted transfer to a number not in the business's on-call config rejected), carrier-level geographic/premium-rate restrictions confirmed enabled, per-tenant outbound-transfer spend caps tested — [18-abuse-prevention-and-telephony-fraud.md](18-abuse-prevention-and-telephony-fraud.md) §1
- [ ] SIP trunk IP allowlisting and TLS/SRTP confirmed enabled, not left at carrier defaults — [18](18-abuse-prevention-and-telephony-fraud.md) §3
- [ ] Secrets audit: no plaintext credentials in code, config files, or logs; all CRM credentials confirmed encrypted at rest
- [ ] PII redaction confirmed in logs shipped to observability tooling
- [ ] RBAC roles tested — a `dispatcher`-role user confirmed unable to modify emergency rules or billing; a `viewer` confirmed read-only
- [ ] Rate limiting verified functional per-tenant at both API gateway and tool broker layers
- [ ] Dependency vulnerability scan clean (or accepted exceptions documented) in CI

## Observability

- [ ] Every call traceable end-to-end from a single trace ID (manually verified by pulling up one real test call's full trace)
- [ ] Latency, cost, and business-metric dashboards live and populated with real pilot data before go-live, not stubbed
- [ ] Alerting confirmed to actually fire (test-triggered: force a circuit breaker open, force a DLQ depth breach) and reach the on-call channel
- [ ] Synthetic canary call scheduled and confirmed running against production

## Reliability

- [ ] Voice-orchestrator blue/green deploy tested against an in-progress live call — confirmed the call completes uninterrupted on the old version while new calls route to the new version
- [ ] Database failover tested in staging (forced RDS failover), application layer confirmed to reconnect without manual intervention
- [ ] Rollback procedure executed at least once in staging (deploy N, roll back to N-1, confirm clean state)
- [ ] Backup/restore tested (not just backups configured — an actual restore-from-backup drill completed)

## CRM integration

- [ ] All 7 HCP must-verify-before-build items resolved against a live sandbox account (see [05-crm-integration.md](05-crm-integration.md) §2.9): auth model (Admin API key vs. OAuth2/Partner Jobs API), phone-search filter parameter, `Create Lead` request schema, Lead note/tag support, webhook signature header name, real rate-limit behavior, real pagination contract
- [ ] HCP adapter contract tests passing (see [05-crm-integration.md](05-crm-integration.md), [10-deployment-cicd.md](10-deployment-cicd.md) §2)
- [ ] Verified against HCP's actual sandbox/production API (not only mocks) for: customer search, customer create, `POST /leads` creation, note attachment (on the resulting Job once converted, if Lead itself doesn't support notes — confirm which applies), webhook receipt of `lead.created`/`lead.converted`
- [ ] Confirmed empirically (not assumed from public docs, which don't state a number) that the adapter's outbound request rate stays comfortably under whatever throttling HCP actually enforces — burst-tested in sandbox, `429`/`Retry-After` handling verified
- [ ] Confirmed the adapter's `createLead()` code path has no ability to reach `Create a Job`, `Update job schedule`, or `Dispatch job to employees` under any input — the actual enforcement of "AI never schedules" one layer below the tool registry ([05](05-crm-integration.md) §3)

## Legal/compliance

- [ ] Call recording disclosure/consent handled per the pilot tenant's state law (two-party consent states require an upfront recording notice — confirmed present in the greeting script where legally required)
- [ ] Data retention policy documented and enforced (transcript/recording retention period configured, not indefinite by accident)
- [ ] GDPR/CCPA deletion workflow tested end-to-end (a test customer's data actually purged on request)

## Operational

- [ ] Runbook exists for: voice vendor outage, CRM outage, notification channel outage, database failover, manual lead replay from DLQ
- [ ] On-call rotation for the _engineering team_ (distinct from the tenant's own on-call technician rotation) established with a real paging path
- [ ] Cost dashboard reviewed against the [09-cost-analysis.md](09-cost-analysis.md) model — actual pilot costs within expected range, no silent surprise (e.g. an unbounded retry loop burning LLM tokens)
- [ ] Documented, tested rollback path to the previous system (HCP's native AI or manual phone answering) if the pilot needs to be paused
