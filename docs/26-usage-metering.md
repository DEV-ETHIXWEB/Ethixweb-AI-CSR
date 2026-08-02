# 26 — Usage & Metering (Phase 9)

As-built documentation for `apps/core-api/src/modules/usage` — a new module, not a revision of any completed phase's architecture. Scope note upfront, since it's the single most important thing to get right reading this doc: **this is a usage-measurement layer, not a billing engine.** No `PricingPlan`, no `PricingRule`, no billing ledger exists in this module, and that's a deliberate scope decision, not an oversight — see §1.

## 1. Why this module stops at "measurement," not "money"

[15-tenant-lifecycle-billing-and-analytics.md](15-tenant-lifecycle-billing-and-analytics.md) §3.1 (formalized as [20-architecture-decision-records.md](20-architecture-decision-records.md) ADR-008) already made this platform's billing architecture decision: **Stripe is the billing system of record**, specifically so this platform never has to re-solve payment card data, tax calculation, dunning, invoicing, or PCI compliance — problems Stripe has already solved. This platform's own tables are meant to be "a cache/mirror of Stripe's state," not a parallel source of truth.

Docs/15 §3.2 is equally explicit about what the metering layer's job actually is: **"one metering pipeline serves both the internal cost dashboard and the customer-facing invoice."** That one pipeline is exactly what this module builds — `UsageRecord`, ingestion, and deterministic aggregation. A vendor-independent `PricingPlan`/`PricingRule`/append-only billing-ledger engine, which a much broader version of this phase's brief asked for, would have been a second, parallel billing system competing with the one docs/15/ADR-008 already committed to. Building it would not have been "closing a gap" — it would have been quietly reversing a documented architecture decision without discussing it first.

**What this means concretely**: `UsageRecord` rows are the normalized, auditable evidence a future Stripe usage-based billing integration (docs/13's `billing` module, Phase 2 per the backlog) will report from. This module produces that evidence. It does not decide what a tenant is charged.

## 2. Usage ingestion contract

`POST /v1/internal/usage` — `UsageToolController`, API-key-only, no `@Roles()` (same "internal tool controller" pattern as `LeadsToolController`/`EmergencyRulesToolController`: this route's callers are other services — primarily voice-orchestrator — not dispatcher-facing dashboard users).

```json
{
  "businessId": "<uuid>",
  "callId": "<uuid, optional>",
  "leadId": "<uuid, optional>",
  "usageType": "voice_call_duration",
  "source": "twilio",
  "quantity": 245,
  "unit": "seconds",
  "estimatedProviderCostUsd": "0.036750",
  "dedupKey": "call-abc123:voice_call_duration:final",
  "metadata": { "twilioCallSid": "CAxxxxxxxx" },
  "occurredAt": "2026-08-02T14:32:10.000Z"
}
```

Returns `201` with the created (or, on a `dedupKey` replay, the pre-existing) `UsageRecord`. `tenantId` is derived from the caller's API-key principal, never accepted as client input (the same discipline every other tenant-scoped write in this codebase follows).

### 2.1 Usage dimensions (`UsageType`)

`apps/core-api/src/modules/usage/domain/usage-record.entity.ts`:

| `usageType`           | Typical `unit` | Typical `source`                              |
| --------------------- | -------------- | --------------------------------------------- |
| `voice_call_duration` | `seconds`      | `twilio`, `telnyx`                            |
| `llm_tokens`          | `tokens`       | `openai:gpt-4o`, `anthropic:claude-*`         |
| `stt_duration`        | `seconds`      | `deepgram`, or whichever STT vendor is active |
| `tts_characters`      | `characters`   | the active TTS vendor                         |
| `telephony_minutes`   | `minutes`      | `twilio`, `telnyx`                            |
| `sms_message`         | `messages`     | `twilio`                                      |
| `notification_sent`   | `count`        | `sms`, `email`, `slack`, `teams`, `webhook`   |
| `crm_api_call`        | `count`        | `housecall_pro`, future adapters              |

`usageType` is **what** was measured; `source` is **who** measured it (a free-form string, not an enum) — a vendor swap (STT provider A → B) never requires a new `usageType`, only a new `source` value. This mirrors docs/21's provider-abstraction discipline: the usage layer doesn't care which vendor produced a measurement, only what dimension it belongs to.

### 2.2 Correlation, not foreign-key enforcement

`callId` and `leadId` on `UsageRecord` are plain UUID columns — **neither is a database foreign key**. This was a real finding during this phase's implementation, documented honestly rather than silently worked around: `Lead.callId` (in the schema since Phase 5) **does** carry a real FK to `calls.id`, but no code anywhere in this repository ever inserts a `Call` row — the `calls` module itself (docs/13) was never built, and voice-orchestrator is deliberately Postgres-free (its own `RedisService` comment states conversation state lives in Redis only). That means `Lead.callId`'s FK constraint would fail against a real Postgres database today; it has simply never been exercised because every existing test uses a fake repository, not real Postgres.

This is a **pre-existing latent bug in the `leads` module (Phase 5)**, not something Phase 9 introduced or is responsible for fixing — per this phase's own instructions (don't redesign a completed phase without a genuine blocking integration bug), and it doesn't block usage/metering, which needs no FK to correlate by `callId`. Adding the same FK to `UsageRecord` would have made every usage-ingestion call fail today, for a constraint nothing currently satisfies — so it was deliberately not added. Flagged here, and in the schema's own comment, so it isn't silently rediscovered later.

### 2.3 Idempotent ingestion

`dedupKey` is client-generated, unique per `(tenantId, dedupKey)` — enforced by a real database unique constraint (`@@unique([tenantId, dedupKey])`), not just an application-level check, matching this codebase's established idempotency discipline (`Notification.dedupKey`, `Lead.callId`, `ToolCall.idempotencyKey`). `RecordUsageUseCase` catches the constraint violation and returns the existing row rather than surfacing an error — a caller that retries after a lost response, or an at-least-once event bus that redelivers, gets back the same record both times. **Repeated delivery of the same usage event cannot double-count**, proven with an explicit `Promise.all` concurrency test (`record-usage.use-case.spec.ts`), the same pattern `CreateLeadUseCase`'s own concurrency test uses.

The dedup contract: one `dedupKey` per real usage _event_, not per API call. A retry of the _same_ event must reuse the _same_ key; two genuinely distinct events (two STT segments of one call, two turns of a conversation) need two distinct keys.

## 3. Metering — deterministic aggregation

`GET /v1/usage/summary?businessId=&usageType=&from=&to=` — `UsageController`, `@Roles("owner", "admin")` (billing-adjacent, same RBAC boundary docs/08 §1.1 draws around billing).

`GetUsageSummaryUseCase` groups `UsageRecord` rows by `(usageType, unit)` over a half-open `[from, to)` interval and sums `quantity`/`estimatedProviderCostUsd`. **Never a stored or cached total** — every call recomputes from the raw rows, so the same query against unchanged data always returns identical output (verified directly: `get-usage-summary.use-case.spec.ts`'s "is reproducible" test). This is what makes the summary trustworthy as evidence, not just a convenient number.

The half-open interval is deliberate: a record occurring exactly at a period's `to` boundary belongs to the _next_ period, not this one — verified with explicit boundary tests so two adjacent billing periods tiled back-to-back can never double-count or drop a boundary record.

`GET /v1/usage/calls/:callId` — the per-call raw evidence trail (`GetCallUsageUseCase`), every `UsageRecord` correlated to one call in chronological order, unaggregated. This is the concrete answer to "why was this tenant charged this amount": start from the summary, drill into the specific call(s) that contributed to it, see every individual measured event.

## 4. Monetary precision

`estimatedProviderCostUsd` is `Decimal(10, 6)` — the identical precision `VoiceSession.totalCostUsd` already uses (docs/06, docs/08 §2.2), never a floating-point number, for the same reason money is never modeled as `float`/`double` anywhere: repeated summation of imprecise binary floating-point fractions drifts from the true total in a way that becomes a real reconciliation problem at scale, not a rounding curiosity. `quantity` itself (the raw usage unit — seconds, tokens, characters) is a plain `Int`, since exact whole-unit counts have no fractional-cent concern at this layer.

**This field is explicitly informational only** — the platform's own estimate of what a vendor charged the platform for this event, extending the exact discipline `voice_sessions.total_cost_usd` already established (docs/08 §2.2's "per-call cost tracking from day one"). It is never read by anything that computes what a _tenant_ is billed. See §1 and §10.

## 5. Row-Level Security & tenant isolation

`usage_records` follows the identical RLS pattern every other tenant-scoped table uses (docs/06 §1, ADR-013/ADR-014): `tenant_id` denormalized onto the table, a `tenant_isolation` policy predicate identical in shape to every other table's, applied via a **new** migration (`00000000000005_usage_records_rls`) rather than editing the historical `00000000000002_rls_policies` migration — per docs/15 §5.1's expand-only migration discipline (an already-applied migration is never retroactively rewritten). Every write and read goes through `TenantContextService.run()`, the same `SET LOCAL`-based session-variable mechanism every other module uses — no new isolation primitive was invented for this module.

Tenant isolation is exercised directly in tests (`record-usage.use-case.spec.ts`, `get-usage-summary.use-case.spec.ts`, `get-call-usage.use-case.spec.ts` each have an explicit "tenant isolation" case proving one tenant's usage is invisible to another's queries, including the specific case of two tenants independently using the identical `dedupKey` — proving dedup is tenant-scoped, not global).

## 6. Failure handling — usage recording must never break a live call

Per this phase's own instructions and this codebase's established reliability posture (docs/08 §3): a billing/metering failure must not terminate an active call, block lead creation, block emergency handling, or block notifications. Concretely, this means **the caller (voice-orchestrator, or any future usage source) is responsible for treating a failed usage-ingestion call as non-fatal** — this module does not and cannot enforce that from the server side, since it has no visibility into the caller's own retry/fallback logic. What this module _does_ guarantee on its own side:

- Ingestion is a single, fast, synchronous write (no external calls, no cross-service dependency) — nothing about `RecordUsageUseCase` itself can hang or cascade-fail the way a CRM/vendor call could.
- A rejected event (invalid quantity, `occurredAt` too far in the future) returns a structured `422` with a specific domain error, not a generic 500 — a caller can distinguish "my request was malformed" from "the service is down" and decide its own retry strategy accordingly.
- Idempotent by construction (§2.3) — a caller's own retry-on-timeout logic is safe by default, never needs its own separate anti-double-submit logic.

**What this module does NOT yet provide, and is real technical debt** (see §15): a durable retry queue for usage events a caller genuinely failed to deliver (network partition, service restart mid-request). Today, if voice-orchestrator's own `POST /internal/usage` call fails and its own retry logic doesn't eventually succeed, that usage event is lost — not silently corrupted, but never recorded. Closing this gap (an outbox-pattern write on the _voice-orchestrator_ side, or a durable client-side retry queue) is Voice Runtime integration work belonging to whoever owns that service's usage-emission code, not something this module can build from the receiving side alone.

## 7. Observability & reconciliation

Every `RecordUsageUseCase` call logs a structured `"usage recorded"` or `"usage ingestion replayed"` event (tenant/type/source/quantity, or tenant/record-id/dedupKey on a replay) via the shared `StructuredLogger` — the same PII-redacting, tenant/trace-correlated logging every other module uses (docs/08 §2.1). `setSpanAttributes` tags `tenant_id`/`business_id`/`usage_type`/`call_id` on every use case's OTel span, so a support engineer can pull up one trace and see exactly which usage events a given call produced, in what order, without a separate query.

"Why was this tenant charged this amount" (this phase's own stated observability requirement) is answerable in two steps from persisted system data alone: `GET /usage/summary` for the aggregate, `GET /usage/calls/:callId` for the itemized evidence behind any specific call within it — no separate reconciliation tooling required, because the summary is always recomputed from the same rows the per-call view reads.

## 8. Integration boundary with the Voice Runtime / voice-orchestrator

**Nothing in `apps/voice-orchestrator` was modified by this phase** — per this phase's own instructions not to unnecessarily rewrite existing modules. Wiring voice-orchestrator to actually call `POST /internal/usage` (e.g., at `end-conversation.use-case.ts`'s natural call-end point, or per-turn for `llm_tokens`) is real, minimal, event-driven integration work for whoever owns that codebase next — this doc is what they need to build against:

- **Endpoint**: `POST {CORE_API_BASE_URL}/v1/internal/usage`, same `CORE_API_SERVICE_API_KEY` credential voice-orchestrator's `HttpCoreApiClient` already uses for the tool-broker's internal calls (docs/25) — no new credential to provision.
- **Natural emission points**: `EndConversationUseCase` (docs/24) is the natural place to emit `voice_call_duration` once a call's total duration is known; each `HandleTurnUseCase` LLM invocation is the natural place to emit `llm_tokens` per turn (the AI provider adapters already return token counts — see `apps/voice-orchestrator/src/modules/ai-provider/infrastructure/*.adapter.ts`).
- **`dedupKey` convention recommended, not yet built into voice-orchestrator**: `${conversationId}:${usageType}:${turnIndex-or-'final'}` — mirrors the `turn:${conversationId}:${idempotencyKey}` convention docs/24 already established for turn-level idempotency, so a Voice Runtime retry of a turn (already required to be safe per docs/24 §2.2) doesn't also double-record that turn's LLM token usage.
- **What this module needs FROM the runtime that it cannot infer on its own**: exact per-provider quantities (STT audio-seconds, TTS character counts, LLM token counts) — the runtime's own AI-provider adapters and STT/TTS integrations are the only place that data actually exists. This module has no way to derive it independently; it can only record what it's told.

This is intentionally the full extent of this phase's touch on voice-orchestrator: a documented contract, zero code changes to a completed phase.

## 9. What Phase 9 deliberately does not build

Per explicit scope confirmation before implementation began (this phase's own gap-analysis step, mirroring Phase 8's pre-implementation audit discipline):

- **No `PricingPlan`/`PricingRule`/`Rate`/pricing versioning** — that's Stripe's job (§1).
- **No billing ledger, `BillingPeriod`, `UsageCharge`, or append-only charge/adjustment/credit model** — same reason.
- **No monetary customer-facing calculation of any kind.** `estimatedProviderCostUsd` is platform-internal vendor-cost visibility only (§4), never a customer charge.
- **No Stripe integration.** Docs/13 places `billing` (including the Stripe integration itself) in Phase 2 of that backlog's numbering — this phase builds the one thing Phase 2's billing module will need as an input, not the module itself.

If a future phase revisits ADR-008 and decides a custom pricing/ledger engine is genuinely warranted after all, `UsageRecord` is already the correct, complete input for it — no rework of this module would be required, only new code layered on top.

## 10. Provider cost vs. customer price — kept structurally separate

Per this phase's own instructions: `estimatedProviderCostUsd` (what Twilio/OpenAI/etc. charges _the platform_) and whatever a tenant is eventually billed (via Stripe, per §1) are deliberately never modeled in the same field, table, or calculation path anywhere in this module. `UsageRecord.quantity`/`unit` (the vendor-agnostic measured usage) is the only data a future pricing layer should read to determine customer price — `estimatedProviderCostUsd` exists purely for the platform's own internal cost-tracking/margin visibility (docs/08 §2.2, docs/09's cost model), and nothing in this module's read paths (`GetUsageSummaryUseCase`, `GetCallUsageUseCase`) implies or computes a customer charge from it.
