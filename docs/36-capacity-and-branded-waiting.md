# 36 — Capacity, Overload Protection & Branded Waiting

As-built documentation for the call-admission gate added to `apps/voice-orchestrator` — a real, distinct product requirement from the idempotency/concurrency-safety work Phases 8-10 already proved. Idempotency answers "can a retry create a duplicate?" (no). This document answers a different question: "what happens when many genuinely different callers try to reach the same tenant at once?" — before this phase, the honest answer was "every call is admitted unconditionally, with no ceiling anywhere in the stack."

## 1. What this phase found missing (the actual gap)

Confirmed by direct audit before writing any code, not assumed:

- **No capacity/concurrency gate existed anywhere** — no semaphore, token bucket, or "max concurrent X" counter in either service or `packages/shared-kernel`.
- **No concurrency control on LLM provider calls** — `OpenAiAdapter`/`AnthropicAdapter`/`GeminiAdapter` all make raw `fetch()` calls with no queueing or rate limiting.
- **BullMQ is documented architectural intent only** — zero source-code references anywhere in either app; only mentioned in docs and Terraform infra provisioning. Not real, wired infrastructure.
- **No load/capacity signal in health checks** — `/healthz`/`/readyz` report liveness and Redis reachability only.
- **No general-purpose HTTP throttling** — `@nestjs/throttler` isn't a dependency of either app; the only existing rate limiter is scoped to login attempts (`apps/core-api`'s auth module), unrelated to call/HTTP concurrency generally.
- **The "filler phrase" tool-latency strategy is a documented prompting strategy, not implemented trigger logic** — `docs/02-voice-pipeline-and-telephony.md` describes it; no code anywhere measures expected tool duration or conditionally instructs the model based on a ~400ms threshold. This phase did not touch or fix that gap — it's a separate, pre-existing finding, noted here because it directly informed §7's design decision (there is no existing mechanism to imitate for "normal-latency filler," only a documented intent).
- **No live infrastructure exists to measure real capacity against** — no Twilio/LiveKit/STT/TTS in this repository, so every numeric limit below is an operator-configurable default, not a measured vendor ceiling. This is stated explicitly rather than left implicit, per this phase's own "do not invent limits" instruction.

## 2. Concurrency model

New module: `apps/voice-orchestrator/src/modules/capacity/`. Configurable via environment variables (`StaticCapacityConfigProvider`), following the exact naming convention requested:

| Variable                       | Default    | Meaning                                                                                                                            |
| ------------------------------ | ---------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `MAX_GLOBAL_CONCURRENT_CALLS`  | 100        | Hard ceiling across all tenants sharing this deployment                                                                            |
| `MAX_TENANT_CONCURRENT_CALLS`  | 10         | Hard ceiling for one tenant — never lets one tenant starve another                                                                 |
| `MAX_WAITING_CALLS`            | 5          | Reserved for a future queue-depth signal — see §9's honest limits on what "waiting" means today                                    |
| `CAPACITY_RESERVATION_TIMEOUT` | 30000 (ms) | Reserved for a future runtime-side waiting-timeout default — this service does not itself hold connections open to enforce it (§4) |
| `CAPACITY_OVERFLOW_NUMBER`     | none       | E.164 human/overflow destination, surfaced in the 429 response body                                                                |

**These are conservative placeholder defaults, not capacity claims** — tune them against real measured LLM/STT/TTS/Voice-Runtime throughput once that infrastructure exists (docs/29 Blocker 1).

## 3. Admission — where it happens and why there

`StartConversationUseCase.execute()` now reserves capacity **first**, before even the FK-ordering-guarantee's blocking `POST /internal/calls` call. A call that can't be admitted should never reach core-api at all — this matches the existing FK-ordering discipline (reject cleanly before any downstream side effect) rather than inventing a new pattern.

```
StartConversationUseCase.execute()
  1. capacityConfig.getActiveConfig(tenantId, businessId)
  2. callAdmission.reserve(...)  ← NEW — throws CapacityExceededError (429) if full
  3. POST /internal/calls        ← unchanged, still blocking (Phase 10's FK guarantee)
  4. assemble system prompt, create Conversation (capacityReservationId attached)
```

`EndConversationUseCase.execute()` releases the reservation, best-effort, in the same pattern as the Call-row close and usage-metering emission already established there.

**Reservation leak guard**: if anything after step 2 fails (core-api outage, a rejected duplicate `callId`), the reservation is released in a `catch` block before the error is re-thrown — otherwise a string of transient failures would slowly starve real capacity for calls that never actually got admitted. Verified directly in `start-conversation.use-case.spec.ts`'s "RESERVATION LEAK GUARD" test.

A Redis TTL on the reservation (4h, matching `CONVERSATION_TTL_SECONDS`) is the safety net if release is never called at all (a crashed runtime, a lost end-signal) — not the primary mechanism.

## 4. Why calls are NOT serialized — and why this service never holds a connection open to "wait"

Normal calls run fully concurrently — confirmed under real concurrent HTTP requests in the e2e suite (§8), not merely by code inspection. Each call gets its own Redis-keyed `Conversation` (`conversation:${tenantId}:${conversationId}`, unchanged from Phase 8), its own correlation IDs, its own tool/idempotency context.

When capacity genuinely is exhausted, `POST /conversations` returns **`429` immediately**, not a held-open HTTP connection pretending to "wait." This was a deliberate design decision: holding a request open to simulate waiting would just move dead-air into a different layer (an open HTTP socket with silence on the other end) rather than removing it — exactly the problem this platform exists to fix. The Voice Runtime is expected to play its own short waiting/brochure experience on its side (where real audio actually lives) and retry per `Retry-After`.

## 5. Emergency priority — the honest limits

**What's NOT possible today**: this service cannot detect that a _specific_ incoming call is an emergency before admission. Confirmed by audit: emergency detection is the `escalateEmergency` tool's job, which requires a conversation and at least one turn to already exist. There is no signal available at `POST /conversations` time that says "this call is a burst pipe."

**What IS possible, and what was built**: `CapacityConfig.emergencyHeadroomRatio` (default 0.2) reserves a fraction of each tenant's ceiling that a **normal** call cannot consume. A call can only use that headroom band if the Voice Runtime explicitly sets `isEmergencyPriority: true` on `POST /conversations` — an optional, best-effort field (`StartConversationDto`), honestly documented as not a guarantee of anything, only a request for the reserved band. This is the only form of "emergency priority" honestly claimable at admission time — it does not prioritize a specific call, it reserves room that's more likely to be free when an emergency-flagged admission attempt arrives.

**A real, load-bearing consequence** (found while writing the e2e tests, not predicted in advance): with the default 20% headroom, a tenant configured for `MAX_TENANT_CONCURRENT_CALLS=3` only admits **2** normal calls before rejecting the 3rd — the third slot is reserved. This is correct, intended behavior, but a real operational gotcha: **operators must account for headroom when setting the ceiling**, or normal call capacity will look lower than the configured number suggests. Documented here explicitly so it isn't rediscovered the hard way in production.

## 6. Branded waiting experience (the "Voice Brochure")

`CapacityConfig.brochure` (`VoiceBrochureConfig`): `enabled`, `businessName`, `segments[]` (each a short `{id, text}` pair), `rotationIntervalMs`. `selectBrochureSegment(config, waitedMs)` (`domain/brochure-rotation.ts`) is a pure function — given how long a caller has waited, which segment should be playing now, rotating through the configured set and wrapping around rather than repeating one segment continuously.

**Only tenant-approved content is ever returned** — the function has no fallback to invented content; `enabled: false` or an empty `segments[]` returns `null`, and callers (the 429 response body, §7) must treat `null` as "say something neutral, not brand-specific," never as an error. There is no code path anywhere that lets the AI/response generate brochure-shaped content outside this configured list — matching the explicit "AI MUST NOT invent years in business/certifications/prices/guarantees/awards/service areas" instruction.

**What was NOT built**: full tenant-facing CRUD for brochure configuration. Confirmed by this phase's own audit that the closest existing precedent — `AgentConfig`/`agent_configs` (the tenant-scoped prompt/voice config table) — is itself unclaimed technical debt: no core-api module exposes it yet, and `StaticAgentProfileProvider` returns hardcoded platform defaults for every tenant today, explicitly flagged as "swap this for an HTTP client once core-api exposes one." `StaticCapacityConfigProvider` follows the identical, deliberate pattern: it returns env-configured global defaults (brochure disabled, empty segments) for every tenant, not real per-tenant content, via the exact same seam (`CapacityConfigProvider`) designed for the same future swap. Building a full `capacity_configs`/`voice_brochures` CRUD module was out of scope for "only the orchestrator," matching the same scoping precedent `StaticAgentProfileProvider` itself was built under.

## 7. Distinguishing normal-latency filler from genuine overload waiting

Per the explicit instruction not to use the brochure during ordinary turn latency: this phase did not touch prompt/turn-latency code at all. The "filler phrase" strategy (§1) remains exactly what it was — a documented prompting strategy for the LLM to emit natural acknowledgments during in-turn tool calls — genuinely unrelated to the brochure, which only ever surfaces in the capacity-exceeded (429) response, never during a normal in-progress turn. These are structurally different code paths (`HandleTurnUseCase` vs. `StartConversationUseCase`'s admission gate) and cannot be confused with each other in the current implementation.

## 8. Human overflow

`CapacityConfig.overflowNumber` (env: `CAPACITY_OVERFLOW_NUMBER`) is surfaced directly in the 429 response body (§9) so the Voice Runtime never needs a second round-trip to discover it. Per the explicit "do not simply disconnect" instruction: the response always includes either a brochure segment, an overflow number, both, or neither (if the tenant configured nothing) — in the last case, the runtime is expected to fall back to its own clear, neutral message per docs/36's own worked example, not silently drop the call. This service does not and cannot force that behavior on the runtime — it can only supply the information; the actual caller-facing decision is the runtime's, consistent with the architecture rule that this service is Postgres/telephony-free and never controls audio.

## 9. The 429 response contract

New: `CapacityExceededFilter` (`interfaces/capacity-exceeded.filter.ts`), a scoped `@Catch(CapacityExceededError)` Nest filter, registered as an additional `APP_FILTER` alongside (not replacing) the existing app-wide `DomainExceptionFilter`. Response shape:

```json
{
  "statusCode": 429,
  "message": "Tenant <id> has reached its concurrent call limit.",
  "error": "CapacityExceededError",
  "scope": "tenant",
  "retryAfterSeconds": 5,
  "waitingExperience": {
    "brochureSegment": { "id": "seg-1", "text": "..." },
    "overflowNumber": "+15551234567"
  }
}
```

`Retry-After: 5` header also set. `scope` is `"tenant"` or `"global"` — lets the runtime's own logging distinguish "this specific business is busy" from "the whole platform is under load," a genuinely different operational signal.

## 10. Observability

No metrics backend exists anywhere in this codebase to emit numeric time-series to (confirmed by audit — no existing metrics client, no NestJS throttler, nothing to attach `active_calls`/`waiting_calls`/etc. counters to as a first-class metric). What was built instead, honestly scoped to what's actually available: structured log lines at admission (`"call admitted: capacity reserved"`, with `tenantId`/`callId`/`reservationId`/`isEmergencyPriority`) and rejection (`"call rejected: capacity exceeded"`, with `tenantId`/`callId`/`scope`) in `StartConversationUseCase`. `CallAdmissionPort.getActiveCounts(tenantId)` exposes the same counters a real metrics pipeline would scrape — the read-side plumbing exists; only the actual metrics-backend wiring (Prometheus/CloudWatch/etc.) is out of scope, since no such backend exists in this repository to wire into (a genuine infrastructure gap, same category as docs/29 Blocker 5's alerting gap, not something to fabricate a fake integration for).

**Not built, and not claimed built**: `capacity_rejections`/`overflow_calls`/`emergency_calls`/`average_wait_time`/`max_wait_time` as queryable metrics, and any alerting on capacity exhaustion, unusual waiting volume, or runtime saturation. These require a real metrics/alerting backend (docs/29 Blocker 5) to be meaningful — logging alone gets you grep-able evidence, not dashboards or pages.

## 11. Tests added

| File                                                           | New tests                   | What they prove                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `capacity/domain/brochure-rotation.spec.ts`                    | 6                           | Disabled/empty brochure returns null, correct segment at t=0, rotation, wraparound, only-approved-content                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `capacity/infrastructure/redis-call-admission.adapter.spec.ts` | 12                          | Reserve/release, tenant/global ceiling enforcement, idempotent release, tenant isolation, emergency headroom (3 tests), **real concurrency race** (10 simultaneous `reserve()` calls against a limit of 5 → exactly 5 admitted, 5 rejected, proving the Lua script's atomicity)                                                                                                                                                                                                                                                                                                  |
| `conversation/application/start-conversation.use-case.spec.ts` | 5 (added to existing file)  | Reservation stored on conversation, rejection blocks the core-api call entirely, reservation-leak guard on downstream failure, `isEmergencyPriority` passthrough (both true and default-false)                                                                                                                                                                                                                                                                                                                                                                                   |
| `conversation/application/end-conversation.use-case.spec.ts`   | 3 (added to existing file)  | Release on end, best-effort failure tolerance, null-reservation defensive no-op                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `test/runtime-contract.e2e.spec.ts`                            | 12 (added to existing file) | **1/5/10/25 concurrent calls** — all admitted, fully isolated (unique conversation IDs, no cross-call leakage); **50 concurrent calls** under the default global ceiling, exactly 50 core-api Call-creation POSTs (no duplicates/merges); tenant ceiling enforcement (with the headroom-aware corrected expectation, §5); global ceiling enforcement across different tenants; 429 body shape (`Retry-After` header + `waitingExperience`); rejected calls never reach core-api; reservation release frees a slot for reuse; emergency-priority admission into the headroom band |
| **Total new tests**                                            | **38**                      |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

These are **behavioral/concurrency tests against the real module graph and a real (mocked) Redis**, not a claim about real production capacity — restated per the explicit instruction, since the two are easy to conflate. Full suite total after this phase: **28 (shared-kernel) + 151 (voice-orchestrator) + 427 (core-api) + 35 (e2e) = 641 tests, 0 failures.**

## 12. What remains genuinely unverifiable without live infrastructure

Unchanged in kind from docs/29's own accounting: real LLM/STT/TTS/Voice-Runtime concurrency limits (no live vendor connections exist to measure), real caller experience of the brochure/waiting flow (requires Yash's live runtime to actually play audio), real alerting on capacity exhaustion (requires a metrics/alerting backend that doesn't exist in this repository), and whether the chosen default ceilings (10 per tenant, 100 global) are anywhere near correct for real traffic — they are operator-tunable placeholders, explicitly not measured claims.
