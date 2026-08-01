# 24 — Voice Runtime ↔ Orchestrator Contract

As-built documentation for what `apps/voice-orchestrator`'s `conversations` HTTP surface actually implements (Phase 8, "Voice Runtime Integration") — not a new architecture proposal. The Voice Runtime (telephony/STT/TTS transport — LiveKit or equivalent, per [02](02-voice-pipeline-and-telephony.md)) is a separate service and an external HTTP client of this API; this document is that API's contract, plus the concrete checklist whoever wires up the real runtime needs.

Verified against `apps/voice-orchestrator/test/runtime-contract.e2e.spec.ts` — a simulator that boots the real Nest module graph (real `ServiceAuthGuard`, real `ValidationPipe`, real controllers/use-cases, real conversation state machine, real `ExecuteToolUseCase` six-stage pipeline) over real HTTP via Fastify's `.inject()`, faking only true external I/O this environment has no live access to (Redis → `ioredis-mock`, the AI provider, and the core-api HTTP client). Every claim below is something that suite actually exercises, not a description of intent.

## 1. Authentication

Every route except `GET /healthz` and `GET /readyz` requires `Authorization: Bearer <ORCHESTRATOR_SERVICE_TOKEN>` — a single shared secret (`ServiceAuthGuard`, `apps/voice-orchestrator/src/shared/auth/service-auth.guard.ts`), not per-tenant credentials, because this service's callers are other **services** (Voice Runtime, core-api), not tenant-scoped dashboard sessions. Missing or wrong token → `401`.

`tenantId` is a request-body field on every call, not derived from the token — the token identifies _a_ trusted caller, not _which tenant_. Every use case re-validates the addressed conversation actually belongs to that `tenantId` before touching it, so a wrong or hostile `tenantId` yields `404`, never another tenant's data (`runtime-contract.e2e.spec.ts`'s "cross-tenant isolation" case).

## 2. The five endpoints

All under `/v1/conversations` (global prefix, `main.ts`).

| Method | Path              | Purpose                                                                                           | Success                           | Key error cases                                                             |
| ------ | ----------------- | ------------------------------------------------------------------------------------------------- | --------------------------------- | --------------------------------------------------------------------------- |
| POST   | `/`               | Start a conversation for a connected call — assembles the layered system prompt once (docs/03 §1) | `201`                             | `409` if a conversation already exists for this `callId`                    |
| POST   | `/:id/turns`      | Submit one finalized caller utterance; runs the LLM/tool loop                                     | `200`                             | `404` unknown conversation, `409` already-ended OR identical turn in flight |
| POST   | `/:id/interrupt`  | Barge-in signal (caller started speaking during TTS)                                              | `200`                             | `404`, `409` illegal transition/already-ended                               |
| POST   | `/:id/end`        | End a conversation — idempotent                                                                   | `200` (always, even called twice) | `404` unknown conversation                                                  |
| GET    | `/:id`            | Fetch session state (never the system prompt or raw messages — Prompt Protection)                 | `200`                             | `404`                                                                       |
| GET    | `/:id/transcript` | Full turn-by-turn transcript                                                                      | `200`                             | `404`                                                                       |

### 2.1 Start

```
POST /v1/conversations
{ "tenantId": "<uuid>", "businessId": "<uuid>", "callId": "<uuid>", "callerAni": "+15551234567", "timezone": "America/Chicago" }
```

`callId` is the Voice Runtime's own call identifier — exactly one conversation may exist per `(tenantId, callId)` pair, enforced atomically in Redis (`SET NX`, `RedisConversationRepository`), not a check-then-write race. A retried "start" for a call already started returns `409`, not a silent duplicate — the runtime should treat that as "fetch the existing conversation via `GET /:id`" (it will need to have cached the `id` from the first `201`, or look it up — there is currently no `findByCallId` HTTP route; see §5).

### 2.2 Turn — idempotency is required, not optional

```
POST /v1/conversations/:id/turns
{ "tenantId": "<uuid>", "idempotencyKey": "<client-generated, unique per turn attempt>", "transcript": "...", "sttConfidence": 0.94, "offsetMs": 12500, "allowedTools": ["searchCustomer", "createLead", ...] }
```

`idempotencyKey` is **required** (`HandleTurnDto`, `@Length(1, 200)`) — this is the Phase 8 gap this build closed. The Voice Runtime must generate one unique value per turn _attempt_ (not per turn — a retry of the same attempt must reuse the same key). Key format server-side: `turn:${conversationId}:${idempotencyKey}` (mirrors the Tool Broker's own `tool:${callId}:${toolName}:${argHash}` pattern, same shared `IdempotencyStore`, 3600s TTL, no separate idempotency mechanism invented for this layer).

- First call with a given key: executes normally, result cached.
- Replay with the **same** key: returns the identical cached `TurnResultResponseDto` — the LLM is **not** re-invoked, no tool call is re-fired. Verified in the simulator by asserting the fake AI provider's request count stays at 1 across a genuine replay.
- A **second, concurrent** request with the same key while the first is still executing: `409` (`TurnAlreadyInFlightError`). A well-behaved runtime should not need to see this in practice (it implies overlapping in-flight requests for the same attempt, which shouldn't happen), but must not treat it as fatal — retry after the first request completes, at which point the replay case above applies.
- Different keys are independent turns, always.

**Practical implication for the runtime**: on any ambiguous outcome (timeout, connection reset, 5xx) where it's unclear whether the turn was actually processed, retry the exact same `{conversationId, idempotencyKey}` pair. It is always safe to do so — never generate a new key for what might be the same attempt.

`allowedTools` is this turn's tool allowlist (docs/04 §2 stage 2's authorization input) and must be non-empty (`@ArrayNotEmpty()`) — pass the full set the current conversation state permits, not a single tool.

### 2.3 Interrupt (barge-in)

```
POST /v1/conversations/:id/interrupt
{ "tenantId": "<uuid>" }
```

Call this when the Voice Runtime's own VAD detects the caller speaking while TTS audio is still playing. **Two distinct mechanisms exist for barge-in, and they are not redundant — a real integration needs both:**

1. **Mid-turn abort**: if a `POST /:id/turns` call is still in flight when barge-in is detected, the runtime should abort that HTTP request (or the underlying `AbortSignal` if calling in-process — see `HandleTurnCommand.signal`). `HandleTurnUseCase` returns whatever text had already streamed (`interrupted: true` in the response) rather than discarding it, because it may already have been spoken — the model's next turn needs an accurate record of what it actually said.
2. **This endpoint**: a lighter-weight signal for when the runtime detects barge-in _between_ turns (TTS still playing from the last turn's response, no new turn HTTP call in flight yet). It transitions conversation state to `silence`.

That `silence` mapping is an **inferred default, not a documented one** — flagged honestly in `ConversationsController.interrupt`'s own comment. Docs/03 §6 and docs/01 §3 describe barge-in purely as "VAD detects speech → cancel TTS → LLM Gateway continues," with **no state-machine transition** in the diagram at all (mechanism 1 above is the actual documented path). `silence` is in fact the state machine's documented representation of the _opposite_ case (VAD timeout — caller says nothing for 6 seconds). No state is documented for "caller interrupted," so this endpoint targets the only state shaped correctly for it (reachable from `greeting`/`identifying`/`qualifying`, recovers back to `qualifying`) rather than leaving `TransitionConversationStateUseCase` — which already existed, fully tested, and unwired to any route before this build — connected to nothing. If a future revision of docs/03 defines a dedicated state for this, update both the code and this paragraph together.

### 2.4 End

```
POST /v1/conversations/:id/end
{ "tenantId": "<uuid>", "endReason": "caller_hangup" }
```

Idempotent by design: ending an already-ended conversation returns the conversation **unchanged** (original `endedAt`/`endReason` preserved, not overwritten) rather than erroring — the runtime may legitimately signal both a caller-hangup event and a call-ended event for the same call. Send whichever reason is available; do not attempt to "correct" an already-set reason with a later call.

## 3. Tool broker integration, as seen from the runtime's side

`turn`'s response (`TurnResultResponseDto`) includes `toolCallsExecuted: string[]` — every tool the model actually invoked during that turn, in order. The runtime does not need to do anything with this beyond logging/observability; tool execution, authorization against `allowedTools`, idempotency, and audit are entirely internal to this service (`ExecuteToolUseCase`, docs/04 §2's six stages). A tool call outside the turn's `allowedTools` is rejected structurally and returned to the model as a tool-result error — it does **not** fail the HTTP request or crash the turn (verified in the simulator).

## 4. What a real integration still needs to confirm (checklist for whoever wires up the live Voice Runtime)

This is the concrete, actionable list — everything here is either genuinely unverifiable without live infrastructure this environment doesn't have, or a deployment-topology decision that belongs to whoever stands up the real runtime, not something guessed at here.

- [ ] **Provision `CORE_API_SERVICE_API_KEY`** for the environment the runtime will call against — see [25-service-credential-provisioning.md](25-service-credential-provisioning.md) for the exact `POST /v1/api-keys` call. Do this per environment (staging, prod); the key is shown once.
- [ ] **Set `ORCHESTRATOR_SERVICE_TOKEN`** to a real generated secret (not the `.env.example` placeholder) in both the Voice Runtime's config and voice-orchestrator's deployed environment — they must match exactly, it's a shared secret, not an issued credential.
- [ ] **Decide how the runtime discovers/caches `conversationId`** after `POST /` — there is currently no `GET` route to look up a conversation by `callId` alone (only `findByCallId` exists at the repository layer, unexposed over HTTP). If the runtime's own process can crash and restart mid-call without losing its in-memory `conversationId`, this is a real gap to close before go-live, not before this phase's scope.
- [ ] **Confirm the runtime's own retry policy generates idempotency keys correctly** per §2.2 above — this is the single most important integration detail in this document. An idempotency key generated fresh on every retry (rather than reused for the same attempt) defeats the entire mechanism and risks double-billing the LLM / double-firing `createLead`.
- [ ] **Confirm `TwilioSignatureGuard`'s `trustProxy` assumption** if Twilio inbound SMS (`apps/core-api`'s `webhooks/sms/claim-reply`, unrelated to this service but same phase) sits behind a real ALB — the guard's own comment flags that URL reconstruction for signature verification is only correct if the Fastify adapter trusts `X-Forwarded-*`, which is not currently set in `main.ts`. A deployment-topology decision, not something resolvable here.
- [ ] **Load-test the barge-in path** (§2.3) against real STT/VAD timing — the two-mechanism design (abort signal + interrupt endpoint) is architecturally sound per docs/03/01, but its actual latency characteristics under a live telephony connection are unverified in this environment (no live LiveKit/Twilio session available).
- [ ] **Confirm the emergency-transfer SIP handoff** — `escalateEmergency`'s `action: "forward_call"` (docs/07 §5, [23](23-phase7-emergency-notification-sequences.md) §1) tells the Voice Runtime to execute a SIP transfer; this service never places or transfers calls itself. Verify the runtime's actual transfer mechanism against a real SIP trunk before relying on this in a live emergency call.

## 5. Known gap, deliberately out of scope for this phase

No HTTP route exposes `ConversationRepository.findByCallId` — only `GET /:id` (by the orchestrator's own generated `id`) exists. Added to the checklist above rather than built speculatively here, since whether it's needed depends on how the real Voice Runtime's process model handles mid-call restarts — a decision for whoever integrates the live runtime, not one to guess at from this environment.
