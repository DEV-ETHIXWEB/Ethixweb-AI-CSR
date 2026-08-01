# 23 — Phase 7 Sequence Diagrams: Emergency Rules & Notification Engine

As-built documentation for what `apps/core-api/src/modules/emergency-rules` and
`apps/core-api/src/modules/notifications` actually implement (docs/07,
docs/13's `emergency-rules`/`notifications` module backlogs) — not a new
architecture proposal. Three flows: emergency escalation, lead notification
through to SMS claim, and the Dead Letter Queue's retry/redrive path.

## 1. Emergency escalation (docs/04 §3.8, docs/07 §5)

The Voice AI Orchestrator never decides severity itself — it calls the
`escalateEmergency` tool, which the Tool Broker routes to core-api's real
rule-matching engine over the internal tool-broker HTTP surface (API-key
auth, no `@Roles()` — see `EmergencyRulesToolController`'s own comment).

```mermaid
sequenceDiagram
    autonumber
    participant AI as Voice AI (LLM)
    participant Broker as Tool Broker<br/>(voice-orchestrator)
    participant API as EmergencyRulesToolController<br/>(core-api, internal)
    participant UC as EscalateEmergencyUseCase
    participant DB as EmergencyRule rows<br/>(tenant-configured, or<br/>DEFAULT_EMERGENCY_KEYWORDS)

    AI->>Broker: tool_call escalateEmergency<br/>{description, detected_keywords}
    Broker->>Broker: 6-stage pipeline (docs/04 §2):<br/>validate → authorize → idempotency →<br/>timeout → execute → audit
    Broker->>API: POST /internal/emergency-rules/escalate<br/>(X-Api-Key)
    API->>UC: execute({businessId, callId, description, detectedKeywords})
    UC->>DB: listActiveByBusiness(tenantId, businessId)
    alt business has configured rules
        DB-->>UC: EmergencyRule[]
        UC->>UC: match description against tenant's own patterns
    else no rules configured yet
        UC->>UC: fall back to DEFAULT_EMERGENCY_KEYWORDS<br/>(docs/07 §5.1 seed table)
    end
    alt match found
        UC-->>API: {isEmergency: true, severity, action, matchedPattern}
    else no match
        UC-->>API: {isEmergency: false, severity: "medium", action: "standard_lead"}
    else UC itself throws (DB unreachable, etc.)
        UC-->>API: {isEmergency: true, severity: "medium", action: "priority_notify"}<br/>(docs/07 §5.2 fail-safe-toward-escalation — never silently downgraded)
    end
    API-->>Broker: EscalateEmergencyResponseDto
    Broker-->>AI: tool result (audited to tool_calls, per docs/04 §2 stage 6)
    Note over AI: The AI never assigns a technician or<br/>books anything itself (docs/01 rule 3) —<br/>action="forward_call" only tells the<br/>Voice RUNTIME to execute a SIP transfer.
```

## 2. Lead created → notification fan-out → SMS "Reply CLAIM"

```mermaid
sequenceDiagram
    autonumber
    participant Lead as CreateLeadUseCase<br/>(leads module)
    participant Outbox as outbox_events table
    participant Poller as OutboxRelayPoller<br/>(in-process, Phase 1 stand-in<br/>for docs/01 §9's BullMQ workers service)
    participant Send as SendLeadNotificationUseCase
    participant Chan as NotificationChannel rows<br/>(sms/email/slack/teams/webhook)
    participant Sender as Channel sender<br/>(Twilio/Slack/Teams/webhook)
    participant Tech as Technician (SMS)
    participant Claim as RedisClaimMappingStore
    participant SmsHook as SmsWebhooksController
    participant ClaimUC as ClaimLeadUseCase<br/>(Phase 5, unchanged)

    Lead->>Outbox: same-transaction write:<br/>lead.created {leadId, businessId, callId}
    loop every 5s
        Poller->>Outbox: fetchPendingBatch()
    end
    Outbox-->>Poller: pending lead.created event
    Poller->>Send: execute({tenantId, businessId, leadId})
    Send->>Chan: listActiveByBusiness (ordered by priorityOrder)
    loop each active channel
        Send->>Send: buildNotificationPayload(lead, customer)<br/>— ONE canonical model, N renderers (docs/07 §3)
        Send->>Sender: send(destination, payload)<br/>up to 3 real attempts (withRetry)
        alt send succeeds
            Sender-->>Send: {success: true}
            Send->>Send: markSent
            opt sms channel tagged with userId
                Send->>Claim: remember(phone, {tenantId, leadId, userId})<br/>TTL 1h — docs/07 §4's short-lived mapping
            end
        else all 3 attempts fail
            Sender-->>Send: {success: false}
            Send->>Send: markDeadLetter (see flow 3)
        end
    end
    Poller->>Outbox: markDispatched
    Sender-->>Tech: SMS: "🔧 New Lead — URGENT ... Reply CLAIM to take this lead."
    Tech->>SmsHook: POST /webhooks/sms/claim-reply<br/>{fromPhone, body: "CLAIM"}
    SmsHook->>Claim: resolve(fromPhone)
    Claim-->>SmsHook: {tenantId, leadId, userId}
    SmsHook->>ClaimUC: execute({tenantId, leadId, claimedByUserId: userId, claimMethod: "sms_reply"})
    Note over ClaimUC: SAME atomic compare-and-set claim<br/>logic the dispatcher dashboard uses —<br/>no second claim implementation.
    ClaimUC-->>SmsHook: claimed (or LeadAlreadyClaimedError if raced)
```

## 3. Notification retry → Dead Letter Queue → redrive

```mermaid
sequenceDiagram
    autonumber
    participant Send as SendLeadNotificationUseCase
    participant Sender as Channel sender
    participant DB as Notification row
    participant Dispatcher as Dispatcher (dashboard)
    participant API as NotificationsController
    participant Requeue as RequeueNotificationUseCase

    Send->>DB: create({status: "pending", dedupKey})
    loop up to 3 attempts (withRetry, 100ms base backoff)
        Send->>Sender: send(destination, payload)
        Sender-->>Send: {success: false, error}
        Note over Send: a `{success:false}` result is promoted to<br/>a THROWN error specifically so withRetry<br/>actually retries it (senders never reject).
    end
    Send->>DB: markDeadLetter (retry budget exhausted)
    Note over DB: status: "dead_letter" — visible, not silently stuck "failed" forever.

    Dispatcher->>API: GET /notifications/dead-letter?page=1
    API-->>Dispatcher: paginated dead-letter Notification rows
    Dispatcher->>API: POST /notifications/{id}/requeue
    API->>Requeue: execute(tenantId, notificationId)
    Requeue->>DB: findById — must be status="dead_letter"
    Requeue->>Requeue: re-fetch lead + customer FRESH,<br/>re-render via buildNotificationPayload<br/>(never redelivers a stale snapshot)
    Requeue->>Sender: send(destination, payload) — one more attempt
    alt succeeds
        Sender-->>Requeue: {success: true}
        Requeue->>DB: markSent
    else fails again
        Sender-->>Requeue: {success: false}
        Requeue->>DB: markDeadLetter (stays in the DLQ, not thrown to the caller)
    end
    Requeue-->>API: RequeueNotificationResponseDto
```
