# 19 — Operational Runbooks

Referenced throughout the rest of the blueprint (the [12-production-readiness-checklist.md](12-production-readiness-checklist.md) gate requires these to exist and be exercised, not just described) — this doc is where the actual step-by-step procedures live, so an on-call engineer at 2am is reading a runbook, not reconstructing intent from architecture prose.

## 1. Incident severity & response process

| Severity | Definition                                                                    | Example                                                                                                                             | Response                                                                                  |
| -------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **Sev1** | Active calls being dropped, or all inbound calls failing, for any tenant      | Voice vendor total outage; database down                                                                                            | Page immediately, incident commander assigned within 5 min, status page updated           |
| **Sev2** | Degraded but functional — calls connect but a non-critical dependency is down | CRM adapter circuit breaker open (leads queue locally, per [04](04-ai-tool-architecture.md) §3.3); one notification channel failing | Page during business hours / on-call during after-hours, fix within defined SLA (e.g. 2h) |
| **Sev3** | No caller-facing impact, but a real problem                                   | DLQ depth climbing; a background sync job failing                                                                                   | Ticketed, addressed within 1 business day                                                 |
| **Sev4** | Cosmetic / non-urgent                                                         | Dashboard UI bug with no data impact                                                                                                | Normal backlog                                                                            |

Every Sev1/Sev2 gets a **blameless post-incident review** within 3 business days: timeline, root cause, what alerting did/didn't catch it, and a tracked action item for the systemic gap (not just the immediate fix) — consistent with the "identify root causes, don't bypass safety checks" engineering principle governing this whole project.

## 2. Runbook: voice vendor outage

**Detection**: synthetic canary call ([08](08-security-observability-reliability.md) §2.4) fails; voice-orchestrator connection-failure rate alert fires ([08](08-security-observability-reliability.md) §2.3); or a tenant reports calls not connecting.

1. Confirm scope: check the voice vendor's status page (LiveKit Cloud, per [02-voice-pipeline-and-telephony.md](02-voice-pipeline-and-telephony.md)) and cross-reference against the platform's own connection-failure metrics — distinguish "vendor is down" from "our config/credentials broke."
2. If vendor-confirmed: this is the scenario [08](08-security-observability-reliability.md) §3's reliability patterns are built for — voice reconnect handles brief blips automatically; a sustained outage needs a human decision.
3. **Fallback decision (must be pre-configured per tenant, not decided live under pressure)**: each business's phone-number configuration includes a pre-agreed "AI platform down" forwarding target (typically the office's own main line or an answering service) — on a confirmed sustained vendor outage, the on-call engineer (or an automated health-check-triggered action, Phase 2+) redirects carrier-level call routing to that fallback target. This is why [11-roadmap-risks-future.md](11-roadmap-risks-future.md)'s risk table treats this as a required runbook rather than an implicit assumption — a caller must never simply get silence because the AI layer is down.
4. Monitor vendor status page for resolution; revert carrier routing to the platform once confirmed healthy and a fresh synthetic canary call succeeds.
5. Post-incident: review whether the outage duration matched what [02](02-voice-pipeline-and-telephony.md) §2's "honest trade-off" section anticipated (LiveKit's recent uptime trailing its own SLA) — if outages are more frequent/longer than planned for, that's an input to the ADR-006-style revisit-trigger discussion in [20-architecture-decision-records.md](20-architecture-decision-records.md), not just a one-off incident.

## 3. Runbook: CRM adapter outage (e.g. Housecall Pro down or rate-limiting hard)

**Detection**: circuit breaker for that tenant's CRM adapter opens ([08](08-security-observability-reliability.md) §3); `crm_sync_log` failure rate alert.

1. Confirm scope (one tenant's credentials/config issue vs. the CRM vendor itself being down).
2. No caller-facing action needed by design: `createLead` already persists locally and marks `pending_crm_sync` on CRM failure ([04-ai-tool-architecture.md](04-ai-tool-architecture.md) §3.3) — calls continue normally, notifications still fire off the local record ([07](07-notification-and-emergency.md) §2).
3. If vendor-wide: monitor for resolution, circuit breaker auto-closes on successful health probe, queued syncs drain automatically via the retry architecture ([01-architecture-overview.md](01-architecture-overview.md) §6).
4. If tenant-specific (e.g. revoked API key — flagged explicitly in [05-crm-integration.md](05-crm-integration.md) §2.9 as something HCP does silently): alert the tenant directly (a revoked/expired credential is invisible to them otherwise), walk them through re-authorizing.
5. Once resolved, verify the sync backlog actually drains (DLQ depth returns to baseline) rather than assuming recovery from the circuit breaker closing alone.

## 4. Runbook: database failover / degradation

**Detection**: RDS Multi-AZ automatic failover event (CloudWatch/RDS event notification); elevated query latency alert.

1. RDS Multi-AZ failover is automatic (typically <60s) — the runbook is about _verifying_ recovery, not performing it: confirm application-layer connection pools reconnected without manual intervention (this exact behavior is a [12-production-readiness-checklist.md](12-production-readiness-checklist.md) gate item, drilled before go-live, so this step should be confirmation, not discovery).
2. If failover does not auto-resolve within RTO (§ objectives in [17-disaster-recovery-multi-region-compliance.md](17-disaster-recovery-multi-region-compliance.md) §1.1): escalate to a manual restore-from-backup/PITR procedure, executed against the drilled process from the quarterly restore-drill cadence (same doc, §1.2) — this is why that drill exists, so this step is "run the thing we've practiced," not "figure this out under pressure for the first time."
3. Post-incident: confirm no data loss beyond the stated RPO; if it was exceeded, that's a Sev1-level post-incident finding, not a footnote.

## 5. Runbook: DLQ (dead letter queue) replay

**Detection**: DLQ depth alert ([08](08-security-observability-reliability.md) §2.3).

1. Inspect DLQ entries in the admin dashboard (per the retry architecture's manual-replay UI, [01-architecture-overview.md](01-architecture-overview.md) §6) — identify whether the failure is transient (safe to replay as-is) or permanent (bad data, revoked auth — needs a fix before replay would help).
2. For transient batches: replay via the dashboard action, confirm success rate, watch DLQ depth return to baseline.
3. For permanent-failure batches: fix the root cause first (e.g. re-authorize a CRM credential per §3 above), then replay — replaying against a still-broken dependency just refills the DLQ and wastes the retry budget.
4. Any DLQ entry older than a defined staleness threshold (e.g. 24h) without resolution escalates automatically to Sev2 — a lead or notification stuck unprocessed for a day is a real business impact (a customer never got called back), not just a queue metric.

## 6. Runbook: credential compromise / suspected fraud (ties to [18-abuse-prevention-and-telephony-fraud.md](18-abuse-prevention-and-telephony-fraud.md))

**Detection**: destination-anomaly cost alert ([18](18-abuse-prevention-and-telephony-fraud.md) §1); SIP failed-auth spike ([18](18-abuse-prevention-and-telephony-fraud.md) §3); a tenant reports unexpected charges.

1. Immediately rotate/revoke the suspected-compromised credential (SIP trunk auth, CRM API key, or platform API key) — err toward fast revocation over investigation-first, since the cost of a few minutes of a legitimate integration being down is far lower than continued fraud exposure.
2. Use the feature-flag kill-switch ([16-ai-evaluation-prompt-versioning-feature-flags.md](16-ai-evaluation-prompt-versioning-feature-flags.md) §4) to disable the affected capability (e.g. call transfer for the affected tenant) platform-side within seconds, without waiting on a deploy.
3. Review `audit_logs` ([06-database-schema.md](06-database-schema.md)) and the tool-broker's `tool_calls` audit trail ([04-ai-tool-architecture.md](04-ai-tool-architecture.md) §4) for the affected tenant/time window to scope the actual impact.
4. Notify the affected tenant directly and transparently — this is a trust-critical moment for a platform whose entire value proposition is reliability or lack thereof.
5. This is always a Sev1/Sev2 post-incident review, specifically checking whether the [18](18-abuse-prevention-and-telephony-fraud.md) controls (destination allowlist, spend caps) functioned as designed or whether a gap needs closing.

## 7. Recurring operational cadence (not incident-triggered, scheduled)

| Activity                                                                                                                                                                 | Cadence                                                                      | Reference                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Full restore-from-backup drill                                                                                                                                           | Quarterly                                                                    | [17-disaster-recovery-multi-region-compliance.md](17-disaster-recovery-multi-region-compliance.md) §1.2                                                |
| Credential/secret rotation (SIP trunk, service-to-service)                                                                                                               | Per a defined schedule (e.g. 90 days) or immediately on suspected compromise | [08](08-security-observability-reliability.md) §1.2, [18](18-abuse-prevention-and-telephony-fraud.md) §3                                               |
| AI eval regression review (are canary/production rubric scores drifting even without a recent prompt change — e.g. an upstream model version silently changing behavior) | Monthly                                                                      | [16-ai-evaluation-prompt-versioning-feature-flags.md](16-ai-evaluation-prompt-versioning-feature-flags.md) §2                                          |
| Access review (who has RBAC admin/owner roles, which API keys are still active and should be)                                                                            | Quarterly                                                                    | [08](08-security-observability-reliability.md) §1.1, §1.6 — also a standing SOC 2 control per [17](17-disaster-recovery-multi-region-compliance.md) §3 |
| Cost-model actuals vs. [09-cost-analysis.md](09-cost-analysis.md) projection review                                                                                      | Monthly, more frequently during Phase 1 pilot                                | [09-cost-analysis.md](09-cost-analysis.md)                                                                                                             |
