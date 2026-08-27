# 37 — Operations Dashboard (backend)

As-built documentation for this phase's actual scope: the **read-only, backend data layer** an operations dashboard would consume, plus the real per-tenant capacity/brochure configuration that replaces the static defaults docs/36 flagged as technical debt. **No frontend was built in this phase** — this repository has no frontend application at all (confirmed by audit before starting: only `apps/core-api` and `apps/voice-orchestrator` exist), and standing one up was explicitly scoped out as a separate, later investment. Everything below is HTTP API surface a future dashboard UI would call.

## 1. What this phase built

Three new `core-api` modules, plus one addition to an existing module:

- **`apps/core-api/src/modules/knowledge`** — tenant-scoped knowledge base with an approval lifecycle and two independent usage flags (AI Knowledge / Waiting Brochure). Full detail in [docs/38](38-knowledge-and-voice-content.md).
- **`apps/core-api/src/modules/capacity-config`** — real, persisted per-business capacity and brochure policy (`TenantCapacityConfig`), replacing voice-orchestrator's env-var-only defaults for anything a tenant actually configures.
- **`apps/core-api/src/modules/dashboard`** — pure composition module with no Prisma access of its own beyond a single `SELECT 1` health probe; every other read composes already-exported use cases from other modules (leads, calls, usage, capacity-config, crm).
- **`apps/core-api/src/modules/calls`** gained `ListCallsUseCase` (previously did not exist — confirmed by audit) — the same `{page, pageSize, status?, createdAfter?, createdBefore?}` → `{items, total}` shape as `ListLeadsUseCase`/`ListCustomersUseCase`.

## 2. Routes

All new tenant-facing routes require JWT auth and are `@Roles(...)`-gated, following this codebase's existing RBAC convention (`RolesGuard`, `UserRole = owner | admin | dispatcher | viewer`).

| Method           | Path                                     | Roles                    | Purpose                                                                                                   |
| ---------------- | ---------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------- |
| `GET`            | `/dashboard/overview?businessId=`        | owner, admin, dispatcher | Composed snapshot: active calls, leads/calls today, capacity utilization, usage today, integration status |
| `GET`            | `/dashboard/emergencies?businessId=`     | owner, admin, dispatcher | Historical emergency escalations — **always empty today**, see §5                                         |
| `GET`            | `/dashboard/health`                      | owner, admin, dispatcher | Component health — see §6 for what's genuinely checkable                                                  |
| `GET`            | `/dashboard/knowledge`                   | owner, admin             | Paginated knowledge item list — see docs/38                                                               |
| `GET/POST/PATCH` | `/dashboard/knowledge/...`               | owner, admin             | Knowledge CRUD + approve/disable — see docs/38                                                            |
| `GET`            | `/dashboard/capacity-config/:businessId` | owner, admin             | Current capacity/brochure policy, platform defaults if unconfigured                                       |
| `PATCH`          | `/dashboard/capacity-config/:businessId` | owner, admin             | Create-or-update (upsert) that policy                                                                     |

Two `internal/*` routes (API-key-authenticated, no `@Roles()`, matching the existing `internal/*` convention exactly — see docs/24 for the general pattern) exist purely for voice-orchestrator to consume, not for the dashboard:

| Method | Path                                               | Purpose                                                                                                           |
| ------ | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/internal/capacity-config/:businessId`            | Same shape as the tenant route — voice-orchestrator's `HttpCapacityConfigProvider` calls this on every call start |
| `GET`  | `/internal/knowledge/:businessId/waiting-brochure` | Approved, `waitingBrochure`-flagged items, priority-ordered, shaped as `{id, text}[]`                             |

**Dashboard-specific routes were only added where no equivalent already existed.** `GET /dashboard/leads`, `/dashboard/calls`, etc. were deliberately NOT built — the leads/customers/notifications modules already expose their own tenant-facing list endpoints (`GET /leads`, etc.); duplicating them under `/dashboard/*` would be pure churn. Only genuine cross-module aggregation (`overview`, `emergencies`, `health`) lives in the dashboard module.

## 3. Why `GetDashboardOverviewUseCase` composes rather than queries directly

Per the explicit architectural rule ("the dashboard must NOT directly access Prisma"), `GetDashboardOverviewUseCase` has zero repository dependencies of its own — it injects `ListCallsUseCase`, `ListLeadsUseCase`, `GetUsageSummaryUseCase`, `GetCapacityConfigUseCase`, and `ListIntegrationsUseCase`, all pre-existing (or newly added, in `ListCallsUseCase`'s case) use cases from their owning modules, and runs them concurrently via `Promise.all`. Counts (`activeCallsCount`, `leadsCapturedToday`, `callsToday`) are derived from each list use case's `.total` field using a `pageSize: 1` query — a real count, not a second, separate count-only code path.

## 4. The honest gap: Postgres-derived counts vs. voice-orchestrator's live Redis counter

`activeCallsCount` and `capacityUtilization` in the overview response are **not the same number** as voice-orchestrator's real-time Redis capacity reservation counter (docs/36's `RedisCallAdmissionAdapter`). `core-api` has no connection to voice-orchestrator's Redis instance and cannot observe it. What `activeCallsCount` actually reflects is `Call` rows with `status = "in_progress"` as of the last write — a reasonable proxy, but one that can genuinely lag the true live count (a call can end in voice-orchestrator's Redis reservation before core-api's `POST /internal/calls/.../end` write lands, or vice versa at admission time). This distinction is documented directly in `GetDashboardOverviewUseCase`'s own code comment, not just here — anyone building a dashboard UI against this endpoint needs to understand it's a **near-real-time proxy**, not the authoritative live count.

## 5. The honest gap: no emergency-escalation flag exists on Lead or Call

`ListDashboardEmergenciesUseCase` always returns `{items: [], total: 0}` today. Confirmed by audit: no field on `Lead` or `Call` marks a row as having been emergency-escalated — `EscalateEmergencyUseCase` (Phase 7) evaluates and notifies, but nothing persists "this call/lead was an emergency" as a queryable column. Closing this gap requires a real schema decision (likely a new field on `Lead` or a join table) that this phase deliberately did not make unilaterally, since it wasn't asked to redesign the emergency module. The dashboard endpoint exists and is wired correctly — it will start returning real data automatically once that schema gap is closed elsewhere, without any change to this module.

## 6. The honest gap: core-api cannot see voice-orchestrator/Redis/HCP/telephony/STT/TTS/LLM health

`GetDashboardHealthUseCase` reports `database: "healthy" | "down"` from a genuine `SELECT 1` against `PrismaService`, and `"unknown"` for every other component (`voiceOrchestrator`, `redis`, `hcp`, `telephony`, `stt`, `tts`, `llm`). This is deliberate, not an oversight: adding a new outbound HTTP call from core-api to voice-orchestrator's `/healthz` (or anywhere else) was explicitly avoided — that's a new cross-service dependency on the read path of a "health" endpoint, which is exactly the kind of thing that should be a considered infrastructure decision (docs/29 Blocker 5, staging/monitoring), not something bolted on inside a single use case. `"unknown"` is the honest, correct answer for what this service cannot see from where it sits — never fabricated as `"healthy"`.

## 7. Per-tenant capacity/brochure configuration is now real

Before this phase, every tenant got the identical env-var-driven defaults (`StaticCapacityConfigProvider`, docs/36). Now:

- `TenantCapacityConfig` (Prisma, one row per business, `@unique businessId`) persists `maxTenantConcurrentCalls`, `maxWaitingCallers`, `waitingTimeoutMs`, `emergencyHeadroomRatio`, `overflowNumber`, `brochureEnabled`, `brochureRotationMs`.
- `GetCapacityConfigUseCase` never throws 404 for a missing row — absence means "use platform defaults" (`PLATFORM_DEFAULT_CAPACITY_CONFIG`, matching the Prisma schema's own `@default(...)` values exactly), the same absence-means-default contract `AgentConfig`/`StaticAgentProfileProvider` already established elsewhere in this codebase.
- `maxGlobalConcurrentCalls` has **no per-business source** — deliberately: a cross-tenant global ceiling is a platform-wide concern, not a per-business one, so it remains the env-var-driven value it always was (`MAX_GLOBAL_CONCURRENT_CALLS`).
- voice-orchestrator's `HttpCapacityConfigProvider` (new, replacing `StaticCapacityConfigProvider` as the default `CAPACITY_CONFIG_PROVIDER` binding) fetches this on every call start via `GET /internal/capacity-config/:businessId`. `StaticCapacityConfigProvider` is retained, not deleted — it's both `HttpCapacityConfigProvider`'s own outage-fallback data source (see §8) and a usable test double.

## 8. Resilience: a core-api outage must never block call admission

`HttpCapacityConfigProvider.getActiveConfig()` sits on `StartConversationUseCase`'s hot path — called on every single call start (docs/36). The two HTTP calls it makes (capacity-config, brochure) are caught **independently**, not under one shared `try/catch`: a brochure-fetch failure degrades only the brochure (falls back to an empty, disabled brochure), never the capacity limits, if those loaded successfully. On a genuine core-api outage, both calls fall back to the exact same numeric defaults `StaticCapacityConfigProvider` uses — including still honoring `MAX_TENANT_CONCURRENT_CALLS`/`MAX_WAITING_CALLS`/`CAPACITY_RESERVATION_TIMEOUT` env-var overrides on the fallback path (a real bug found and fixed during this phase's independent verification — the first implementation silently dropped these overrides on the outage path; caught by re-running the e2e suite after the agent's own self-reported "clean" verification, not trusted on the agent's word alone). Verified with a dedicated unit test asserting the fallback fires correctly on both a network error and an HTTP 500.

## 9. Security / tenant isolation

Every new use case receives `tenantId` from `AuthPrincipal` (JWT claims or, for the two `internal/*` routes, the API-key's own tenant binding) — never from a client-supplied body/query field for anything security-relevant. Every repository method is `db`-parameterized and called inside `TenantContextService.run(tenantId, ...)`, so Postgres Row-Level Security (not just application-layer filtering) is the actual enforcement mechanism — the same architecture every existing module uses. `KnowledgeController`/`CapacityConfigController` are `@Roles("owner","admin")`-gated (config/approval actions); `DashboardController` allows `dispatcher` too (read-only operational visibility, matching `LeadsController`'s own role list — a dispatcher needs the same visibility a lead inbox already gives them). No route in this phase allows a `viewer` role, consistent with every other operational surface in this codebase.

## 10. Tests

57 new core-api tests (knowledge module, capacity-config module, dashboard module, `ListCallsUseCase`) + 5 new voice-orchestrator tests (`HttpCapacityConfigProvider`). Full suite total after this phase: **shared-kernel 28 + voice-orchestrator 156 + core-api 484 + e2e 35 = 703 tests, 0 failures.**

## 11. What remains for an actual dashboard UI

Everything in this document is API surface only. A real dashboard frontend still needs: a frontend application (framework choice, auth flow, deployment target — none of which exist in this repo), real-time/polling strategy against these endpoints, and UI design. None of that was in scope for this phase.
