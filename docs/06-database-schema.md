# 06 — Database Schema

Primary store: **PostgreSQL 16+**. Every tenant-scoped table has `tenant_id uuid NOT NULL` and a Row-Level Security policy (`USING (tenant_id = current_setting('app.tenant_id')::uuid)`), set by the connection middleware at the start of every request/call session. This is defense in depth on top of application-layer scoping — a bug in a repository's `WHERE` clause cannot leak cross-tenant data.

## 1. ER diagram

```mermaid
erDiagram
    TENANTS ||--o{ BUSINESSES : owns
    TENANTS ||--o{ USERS : has
    TENANTS ||--o{ API_KEYS : has
    BUSINESSES ||--o{ INTEGRATIONS : configures
    BUSINESSES ||--o{ AGENT_CONFIGS : configures
    BUSINESSES ||--o{ EMERGENCY_RULES : defines
    BUSINESSES ||--o{ BUSINESS_HOURS : defines
    BUSINESSES ||--o{ ONCALL_ROTATIONS : defines
    BUSINESSES ||--o{ NOTIFICATION_CHANNELS : defines
    BUSINESSES ||--o{ CUSTOMERS : serves
    BUSINESSES ||--o{ CALLS : receives
    CUSTOMERS ||--o{ CALLS : places
    CUSTOMERS ||--o{ LEADS : generates
    CALLS ||--|| VOICE_SESSIONS : has
    CALLS ||--o{ TRANSCRIPTS : produces
    CALLS ||--o{ TOOL_CALLS : triggers
    CALLS ||--o| LEADS : results_in
    LEADS ||--o{ NOTIFICATIONS : triggers
    LEADS ||--o| LEAD_CLAIMS : claimed_by
    ONCALL_ROTATIONS ||--o{ ONCALL_SHIFTS : schedules
    INTEGRATIONS ||--o{ CRM_SYNC_LOG : records
    TENANTS ||--o{ AUDIT_LOGS : records
    BUSINESSES ||--o{ WEBHOOK_SUBSCRIPTIONS : registers
    WEBHOOK_SUBSCRIPTIONS ||--o{ WEBHOOK_DELIVERIES : logs

    TENANTS {
        uuid id PK
        text name
        text plan_tier
        text status
        timestamptz created_at
    }
    BUSINESSES {
        uuid id PK
        uuid tenant_id FK
        text name
        text timezone
        text crm_type
        text status
        timestamptz created_at
    }
    USERS {
        uuid id PK
        uuid tenant_id FK
        text email
        text role
        timestamptz last_login_at
    }
    API_KEYS {
        uuid id PK
        uuid tenant_id FK
        text key_hash
        text scopes
        timestamptz expires_at
        timestamptz revoked_at
    }
    INTEGRATIONS {
        uuid id PK
        uuid business_id FK
        text crm_type
        text auth_type
        bytea encrypted_credentials
        jsonb config
        text status
        timestamptz last_verified_at
    }
    AGENT_CONFIGS {
        uuid id PK
        uuid business_id FK
        int version
        jsonb prompt_config
        text voice_vendor
        text voice_id
        text llm_model
        boolean is_active
        timestamptz created_at
    }
    EMERGENCY_RULES {
        uuid id PK
        uuid business_id FK
        text keyword_or_pattern
        text severity
        text escalation_action
        boolean is_active
    }
    BUSINESS_HOURS {
        uuid id PK
        uuid business_id FK
        int day_of_week
        time open_time
        time close_time
        text holiday_calendar_ref
    }
    ONCALL_ROTATIONS {
        uuid id PK
        uuid business_id FK
        text name
        text strategy
    }
    ONCALL_SHIFTS {
        uuid id PK
        uuid rotation_id FK
        uuid user_id FK
        timestamptz starts_at
        timestamptz ends_at
        text phone_override
    }
    NOTIFICATION_CHANNELS {
        uuid id PK
        uuid business_id FK
        text channel_type
        jsonb destination
        boolean is_active
        int priority_order
    }
    CUSTOMERS {
        uuid id PK
        uuid tenant_id FK
        uuid business_id FK
        text crm_customer_id
        text phone_e164
        text name
        text email
        jsonb address
        jsonb crm_raw_cache
        timestamptz created_at
        timestamptz updated_at
    }
    CALLS {
        uuid id PK
        uuid tenant_id FK
        uuid business_id FK
        uuid customer_id FK
        text direction
        text from_number
        text to_number
        text telephony_call_sid
        text status
        text end_reason
        int duration_seconds
        text recording_url
        timestamptz started_at
        timestamptz ended_at
    }
    VOICE_SESSIONS {
        uuid id PK
        uuid call_id FK
        text stt_provider
        text tts_provider
        text llm_model
        int total_llm_tokens
        numeric total_cost_usd
        jsonb latency_metrics
    }
    TRANSCRIPTS {
        uuid id PK
        uuid call_id FK
        int turn_index
        text speaker
        text text
        numeric confidence
        int offset_ms
        timestamptz created_at
    }
    TOOL_CALLS {
        uuid id PK
        uuid call_id FK
        text tool_name
        jsonb input
        jsonb output
        text status
        text idempotency_key
        int duration_ms
        text error_message
        timestamptz created_at
    }
    LEADS {
        uuid id PK
        uuid tenant_id FK
        uuid business_id FK
        uuid customer_id FK
        uuid call_id FK
        text crm_lead_id
        text problem_summary
        text priority
        text lead_type
        text status
        jsonb qualification_data
        timestamptz created_at
    }
    LEAD_CLAIMS {
        uuid id PK
        uuid lead_id FK
        uuid claimed_by_user_id FK
        text claim_method
        timestamptz claimed_at
    }
    NOTIFICATIONS {
        uuid id PK
        uuid lead_id FK
        text channel_type
        text destination
        text status
        text dedup_key
        int attempt_count
        timestamptz sent_at
    }
    CRM_SYNC_LOG {
        uuid id PK
        uuid integration_id FK
        text operation
        text entity_type
        text entity_id
        text status
        text idempotency_key
        jsonb request_payload
        jsonb response_payload
        timestamptz created_at
    }
    AUDIT_LOGS {
        uuid id PK
        uuid tenant_id FK
        uuid actor_id
        text actor_type
        text action
        text resource_type
        text resource_id
        jsonb before
        jsonb after
        text ip_address
        timestamptz created_at
    }
    WEBHOOK_SUBSCRIPTIONS {
        uuid id PK
        uuid business_id FK
        text target_url
        text secret_hash
        text[] event_types
        boolean is_active
    }
    WEBHOOK_DELIVERIES {
        uuid id PK
        uuid subscription_id FK
        text event_type
        jsonb payload
        int response_status
        int attempt_count
        text status
        timestamptz delivered_at
    }
```

## 2. Notes on key design decisions

- **`customers.crm_customer_id` + unique index on `(business_id, phone_e164)`**: the phone-based dedup lookup (see [05-crm-integration.md](05-crm-integration.md) §4) is a DB-level unique constraint, not just an application check — this is what actually prevents duplicate customers under concurrent calls from the same number (e.g. someone calls twice within seconds because the first call dropped).
- **`customers.crm_raw_cache`**: a JSONB cache of the last-fetched CRM record, refreshed on read with a TTL. Avoids a live CRM API round-trip on every conversation turn that needs customer context, while `crm_customer_id` remains the source of truth pointer.
- **`leads.status`**: enum `new → notified → claimed → (converted_to_job | expired | duplicate)`. `converted_to_job` is set by a webhook from the CRM once a human actually schedules it — closing the loop for reporting without the AI ever touching scheduling.
- **`tool_calls` table is the AI audit trail**: every tool invocation, its exact input/output, and its idempotency key are recorded, independent of the LLM provider's own logs. This is what makes a support ticket ("why did the AI say X") answerable from our own data.
- **`voice_sessions.latency_metrics`**: JSONB rather than fixed columns because the fields captured (STT latency, LLM TTFT, TTS TTFB, barge-in count, etc.) will grow as the pipeline is tuned — see [08-security-observability-reliability.md](08-security-observability-reliability.md) for what's captured and why.
- **Soft multi-tenancy plus RLS, not schema-per-tenant**: schema-per-tenant (or DB-per-tenant) is tempting for "true" isolation but multiplies migration complexity linearly with tenant count and makes cross-tenant analytics (needed for the platform's own product metrics) require fan-out queries. RLS + shared schema is the standard, proven pattern (Supabase, most B2B SaaS) for this scale; DB-per-large-tenant remains an option for a future enterprise tier without a schema rewrite, since the ORM layer is already tenant-aware.
- **`audit_logs` is append-only** (`REVOKE UPDATE, DELETE` at the DB role level) — required for the GDPR/SOC2 posture in [08-security-observability-reliability.md](08-security-observability-reliability.md).
- **Prisma is the ORM** (see [stack rationale in 10](10-deployment-cicd.md)); the schema above maps close to 1:1 to `schema.prisma` models, with RLS policies applied via raw SQL migrations since Prisma doesn't manage RLS natively.

## 3. Indexing strategy (hot paths)

| Query                                     | Index                                                                                                       |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Find customer by phone during active call | `UNIQUE (business_id, phone_e164)` on `customers`                                                           |
| Load recent transcript for context window | `(call_id, turn_index)` on `transcripts`                                                                    |
| Lead inbox / claim UI                     | `(business_id, status, created_at DESC)` on `leads`                                                         |
| Outbox/webhook relay polling              | `(status, created_at)` partial index `WHERE status = 'pending'` on `webhook_deliveries` and `notifications` |
| Tenant-scoped everything                  | every FK column + RLS predicate column (`tenant_id`) indexed                                                |

## 4. Retention & partitioning

`transcripts`, `tool_calls`, and `crm_sync_log` are high-volume, append-mostly tables — partitioned by month (Postgres native declarative partitioning) from day one so retention policies (e.g. "raw transcripts kept 2 years, then archived to S3 as compressed JSONL and dropped from Postgres") are a partition-drop, not a `DELETE` that locks a huge table.
