# 28 — Voice Runtime Integration Package

**Historical framing note**: this was originally written for an external
integrator ("Yash") to wire a separate, not-yet-built runtime against
`voice-orchestrator`. That plan changed with Phase 15B — `apps/voice-runtime`
in this repo is now that runtime, self-owned by Akash (this project's sole
owner), and it implements this exact contract. The contract itself below
remains the accurate, current interface spec (still worth reading in full
if extending or debugging `apps/voice-runtime`'s own integration with
`voice-orchestrator`); only the "for an external party" framing is stale.

This is the complete, standalone contract for connecting a real Voice Runtime (Twilio + LiveKit + Deepgram, or any equivalent telephony/STT/TTS stack) to `apps/voice-orchestrator`. You should not need to read any other file in this backend to wire your runtime against it — everything here is either copied verbatim from the real, tested DTOs/guards/use-cases, or explicitly marked as not yet verified against a live system.

If anything here disagrees with the actual running service, the service is correct and this doc has drifted — file that as a bug against this doc, not against your integration.

## A. Endpoints (all under `/v1`, base URL is wherever voice-orchestrator is deployed)

| Method | Path                            | Purpose                                                      |
| ------ | ------------------------------- | ------------------------------------------------------------ |
| POST   | `/conversations`                | Call connected — start a conversation                        |
| POST   | `/conversations/:id/turns`      | One finalized caller utterance                               |
| POST   | `/conversations/:id/interrupt`  | Caller started speaking during TTS (barge-in, between turns) |
| POST   | `/conversations/:id/end`        | Call ended                                                   |
| GET    | `/conversations/:id`            | Fetch session state (debugging/observability only)           |
| GET    | `/conversations/:id/transcript` | Full turn-by-turn transcript                                 |

## B. Required request fields (per endpoint)

### B.1 Start — `POST /conversations`

```json
{
  "tenantId": "<uuid>",
  "businessId": "<uuid>",
  "callId": "<uuid>",
  "callerAni": "+15551234567",
  "toNumber": "+15559876543",
  "timezone": "America/Chicago"
}
```

- `tenantId`, `businessId`: which Ethixweb tenant/business this call belongs to. Your runtime needs to resolve these from the dialed number (`toNumber`) before calling this endpoint — that mapping is outside this service's scope (it's telephony-provisioning configuration, not something core-api or voice-orchestrator computes for you).
- `callId`: **generate this yourself, once, per call — a UUID.** This is the single most important field in the whole contract. It becomes the idempotency key for call creation in core-api, the correlation ID across every downstream system, and the value you must reuse for every subsequent request on this call (turns, interrupt, end). If your runtime restarts mid-call, it must remember this value or the call cannot be correctly resumed.
- `callerAni`: the caller's number, E.164 format (`+15551234567`), required.
- `toNumber`: optional, E.164, the number the call landed on. Omit it if unavailable — it defaults to a placeholder and does not block anything.
- `timezone`: optional IANA timezone string, defaults to UTC if omitted.

**Response**: `201` with the conversation object (see §C.1). **Save the returned `id` — the `conversationId` — you need it for every subsequent call.** There is currently no way to look it up later by `callId` alone over HTTP (a known, documented gap — see §I).

**409** if a conversation already exists for this exact `callId` (you retried the start call and it actually succeeded the first time — this is not a failure, treat it the same as if you'd gotten the `201`, except you don't have the `conversationId` from this response; this is the specific scenario §I's gap affects).

### B.2 Turn — `POST /conversations/:id/turns`

```json
{
  "tenantId": "<uuid>",
  "idempotencyKey": "<uuid, unique per turn ATTEMPT>",
  "transcript": "Hi, my water heater is leaking",
  "sttConfidence": 0.94,
  "offsetMs": 12500,
  "allowedTools": [
    "searchCustomer",
    "createCustomer",
    "createLead",
    "getBusinessHours",
    "getServiceAreas",
    "escalateEmergency",
    "lookupPreviousCalls",
    "updateLead"
  ]
}
```

- **Only send finalized STT transcripts.** Do not send interim/partial results into this endpoint — the platform's own conversation-quality and safety guarantees assume every turn is a complete, final utterance the model reasons over once. There is no separate "partial transcript" endpoint; if your STT provider streams partials, buffer until finalization on your side.
- `idempotencyKey`: **generate a new one per turn ATTEMPT, and reuse the SAME value if you retry that exact attempt.** This is not "one key per turn" — it's "one key per network round-trip you're willing to consider the same logical action." If a request times out and you don't know whether it succeeded, retry with the identical `idempotencyKey`; you will get back the identical cached result, never a duplicate LLM invocation.
- `allowedTools`: the full list of tool names this turn's agent configuration is permitted to reach. Pass the complete allowlist every time, not a single tool — this is checked as a real authorization gate (`ExecuteToolUseCase` stage 3), and a name outside it is rejected structurally, safely, without crashing the turn.

**Response** (`200`, see §C.2 for the exact shape): `responseText` is what you should synthesize and speak. `interrupted: true` means the response was cut short by a barge-in signal you sent mid-turn — speak what you have, don't wait for more.

**409**: either the conversation already ended, or an identical `idempotencyKey` is already being processed concurrently (should not happen in normal operation — see §G).

### B.3 Interrupt — `POST /conversations/:id/interrupt`

```json
{ "tenantId": "<uuid>" }
```

Call this when your own VAD detects the caller speaking while TTS is still playing and there is **no turn HTTP request currently in flight**. If a turn request IS in flight when barge-in is detected, the correct action is different: **abort that in-flight HTTP request directly** (or the underlying signal, if you're calling in-process rather than over HTTP) — this endpoint is the lighter-weight, between-turns signal only. Both mechanisms are real and both matter; using only one is an incomplete barge-in implementation.

### B.4 End — `POST /conversations/:id/end`

```json
{ "tenantId": "<uuid>", "endReason": "caller_hangup" }
```

`endReason` is a free-form string (max 100 chars) — use whatever value is meaningful to you (`caller_hangup`, `runtime_disconnected`, `transferred`, etc.), it's stored verbatim for observability. **Idempotent and safe to call twice** — if you send both a caller-hangup signal and a separate call-ended signal, the second call succeeds and returns the conversation unchanged (the first `endReason` wins, it is never overwritten).

## C. Response schemas

### C.1 `ConversationResponseDto` (from start/interrupt/end/get)

```json
{
  "id": "conversation-uuid",
  "tenantId": "...",
  "businessId": "...",
  "callId": "...",
  "state": "greeting",
  "llmModel": "gpt-4o",
  "leadId": null,
  "turnCount": 0,
  "startedAt": "2026-08-07T12:00:00.000Z",
  "endedAt": null,
  "endReason": null,
  "greeting": "Thanks for calling All Phase Plumbing, how can I help?"
}
```

`state` is one of: `greeting`, `identifying`, `qualifying`, `emergency_check`, `emergency_transfer`, `confirming`, `closing`, `human_requested`, `voicemail`, `silence`, `ended`. This is informational for your own logging/dashboards — you never need to branch your own logic on it; state transitions are entirely internal to the orchestrator.

**`greeting` (present ONLY on the response from `POST /conversations`, absent on interrupt/end/get — check with `if (response.greeting)`, not a null check):** the AI's opening line, generated once at call start. **Your runtime MUST speak this before opening the mic for real.** This closes the single most serious gap found in this whole build, live: every real call connected successfully through this entire contract — webhook answered, Media Stream opened, `POST /conversations` returned 201 — and then NOTHING ever spoke, because no version of this document before now ever specified a greeting step at all. Both sides waited in silence for the other to speak first, forever; a caller hearing dead air on connect reasonably assumes the call itself failed to go through. If your runtime does not speak `greeting` immediately after call-start succeeds, your integration has this exact bug regardless of anything else in this contract being correctly implemented.

Deliberately **excluded** from this response: the system prompt and raw message history. Never expect them, never build anything that depends on receiving them.

### C.2 `TurnResultResponseDto` (from turn)

```json
{
  "conversationId": "...",
  "responseText": "Got it, let me get someone to call you back about that.",
  "toolCallsExecuted": ["searchCustomer"],
  "interrupted": false,
  "state": "qualifying"
}
```

`toolCallsExecuted` lists every tool name the model _requested_ this turn (including ones later rejected — see the note in [27-phase10-runtime-integration-e2e.md](27-phase10-runtime-integration-e2e.md) §5). Useful for your own logging; you never need to act on it.

**`escalation` (optional field, added for the voice-runtime build — Phase 15B)**: present only on the turn where `escalateEmergency` succeeded with `isEmergency: true`. Absent (not `null`) on every other turn — check with `if (response.escalation)`, not a null check.

```json
{
  "conversationId": "...",
  "responseText": "Okay, I'm connecting you to someone right now, please stay on the line.",
  "toolCallsExecuted": ["escalateEmergency"],
  "interrupted": false,
  "state": "emergency_transfer",
  "escalation": { "severity": "critical", "action": "forward_call" }
}
```

This closes a real, previously-open gap: earlier revisions of this document said "the tool result itself signals this to your runtime" (§M), but the actual `TurnResultResponseDto` had no such field — only an internal `escalation.triggered` event existed, which an out-of-process HTTP client cannot subscribe to. `action` is one of `EmergencyAction` (`forward_call`, `priority_notify`, `standard_lead` — see `apps/voice-orchestrator/src/modules/tool-broker/application/handlers/escalate-emergency.handler.ts`); only `forward_call` requires your runtime to execute a transfer. `severity` is `critical` | `high` | `medium`, informational.

## D. Authentication

Single shared bearer token, every request, every endpoint except `GET /healthz` and `GET /readyz`:

```
Authorization: Bearer <ORCHESTRATOR_SERVICE_TOKEN>
```

This is a shared secret between your runtime and this deployment of voice-orchestrator — not a per-call or per-tenant credential. Get the actual value out-of-band from whoever manages the deployment's environment variables; it is never returned by any API call. Missing or wrong token → `401` on every route.

## E. Tenant/business identification

`tenantId` and `businessId` are **request-body fields you supply on every call**, not derived from your auth token — the token identifies _your runtime_ as a trusted caller, not _which tenant_. Every use case internally re-validates that the conversation you're addressing actually belongs to the `tenantId` you sent; a wrong or spoofed `tenantId` gets a `404`, never another tenant's data. You (or whatever system provisions your runtime's phone-number-to-tenant mapping) are responsible for knowing which tenant/business a given inbound number belongs to.

## F. Correlation IDs

One value threads the whole system: **`callId`** (the UUID you generate at call-start). It becomes:

- `calls.telephony_call_sid` in core-api's database (the idempotency key for call creation)
- The `callId` argument on every tool call (`createLead`, `escalateEmergency`, etc.)
- The `callId` field on every usage-metering event
- Part of the URL path for ending the call (`POST /internal/calls/by-telephony-sid/:callId/end` — an internal core-api route, not one your runtime calls directly)

Log `callId` (and the `conversationId` you get back from start) on every request your runtime makes, and you can reconstruct a call's entire path through the system from logs alone — this was verified directly in this phase (`runtime-contract.e2e.spec.ts`'s correlation-ID propagation test).

## G. Retry rules

- **Start**: a retry with the identical payload against an existing `callId` gets `409`, not a duplicate. If you don't have the `conversationId` from the original attempt, see §I's known gap.
- **Turn**: retry with the SAME `idempotencyKey` for the SAME attempt. On any ambiguous outcome (timeout, connection reset, 5xx) where you don't know whether the turn was actually processed, retry exactly this way — it is always safe. **Never generate a fresh key for what might be the same attempt** — that defeats the entire mechanism and risks double-firing tool calls (double-creating leads, double-sending notifications).
- **End**: safe to call twice, always, with any `endReason`.

## H. Idempotency rules

Enforced server-side via real database/Redis unique constraints, not just application checks:

- One conversation per `(tenantId, callId)` — atomic.
- One turn result per `(conversationId, idempotencyKey)` — cached, replayed verbatim on retry, the LLM is never re-invoked.
- One `Call` row per `(tenantId, telephonyCallSid)` — `telephonyCallSid` here is your `callId`.

## I. Known gap: no lookup-by-callId endpoint

If your runtime's process crashes and restarts mid-call, it currently has no way to recover the `conversationId` for an in-progress call from `callId` alone over HTTP — only `GET /conversations/:id` (by the orchestrator's own generated id) exists. This is a **deliberate, documented deferral** from Phase 8 (see docs/24 §5), not an oversight discovered late. If your runtime's process model can crash and restart mid-call without losing in-memory state, this doesn't block you. If it can't, this needs to be closed before go-live — raise it, it's a small addition (`ConversationRepository.findByCallId` already exists at the repository layer, just isn't exposed as a route).

## J. Call-start behavior — exact sequence

1. Your runtime detects a connected call, generates `callId`.
2. `POST /conversations` with `callId` + caller info. **This call is synchronous and must succeed before you do anything else** — internally it creates a `Call` row in core-api's database first (blocking), then the conversation itself, THEN runs one non-tool LLM completion to produce the opening greeting (see §C.1's own note — this is new, and closes the most serious bug found in this whole build). If this call fails, the call cannot proceed through this platform; handle that failure explicitly (fallback routing, an apology message via a static TTS clip, etc. — this is a real production decision your runtime owns, not something voice-orchestrator can decide for you).
3. Save the returned `conversationId`.
4. **Speak `greeting` from the response.** Do this AFTER your STT session is open and its handlers are registered, not before — a caller barging in before the greeting finishes needs your existing barge-in mechanism to fire correctly, the same as it would mid-turn later in the call, not a special case only this one utterance needs.

## K. Finalized-turn behavior — exact sequence

1. Your STT finalizes an utterance.
2. Generate an `idempotencyKey` for this attempt.
3. `POST /conversations/:id/turns`.
4. Speak `responseText` from the response. If `interrupted: true`, you already know why (you sent an abort/interrupt signal) — just speak what came back and continue.

## L. Call-end behavior — exact sequence

1. Call disconnects (either party).
2. `POST /conversations/:id/end` with whatever reason you have.
3. Best-effort on the backend side from here — the underlying `Call` row close and a usage-metering event both happen internally and are **non-blocking**; a core-api outage at this exact moment cannot and will not affect your runtime's own hangup handling. You don't need to retry this call for those internal side effects — retry it only if the HTTP request to voice-orchestrator itself genuinely failed.

## M. Emergency behavior

You do not detect emergencies — the model does, via the `escalateEmergency` tool, which must be present in every turn's `allowedTools` list for a qualification-stage conversation. When the model calls it and gets back `action: "forward_call"`, that is a signal **to your runtime**, not an automatic action this backend takes — you are responsible for executing the actual SIP transfer/call-forward.

The signal arrives as `escalation: {severity, action}` on that turn's `TurnResultResponseDto` (§C.2) — added in the voice-runtime build (Phase 15B) to close what was previously an undetectable gap (the tool result was only ever published as an internal event, never exposed over HTTP). This mechanism has **not been verified against a live SIP trunk** in this environment (no live telephony available) — test it explicitly before relying on it for a real emergency call.

## N. Error responses

Standard shape from every endpoint on failure:

```json
{
  "statusCode": 404,
  "message": "Conversation not found: ...",
  "error": "ConversationNotFoundError"
}
```

| Status | Meaning                                                   | Your action                                                            |
| ------ | --------------------------------------------------------- | ---------------------------------------------------------------------- |
| 400    | Malformed request body (validation failure)               | Fix the payload — this is a client bug, don't retry unchanged          |
| 401    | Missing/wrong bearer token                                | Check your `ORCHESTRATOR_SERVICE_TOKEN` config                         |
| 404    | Conversation/tenant mismatch not found                    | Don't retry — the conversation genuinely doesn't exist for that tenant |
| 409    | Conflict (duplicate start, already-ended, in-flight turn) | See §G's retry rules per endpoint                                      |
| 5xx    | Internal failure                                          | Retry per §G's idempotency rules — always safe                         |

Never logs secrets; never logs your bearer token or raw caller PII beyond what's already in the request you sent.

## O. Local testing instructions

You do **not** need real Twilio/LiveKit/Deepgram credentials to test your integration logic against this contract. Use the exact same simulator this backend's own test suite uses:

```bash
pnpm --filter @ethixweb/voice-orchestrator run test:e2e
```

This boots the real Nest application (real auth guard, real validation, real conversation state machine, real Tool Broker) over real HTTP, faking only Redis and the AI provider — see `apps/voice-orchestrator/test/voice-runtime-simulator.ts` if you want to write your own scripted scenarios against the same harness before pointing real telephony at a live deployment. Every scenario in `runtime-contract.e2e.spec.ts` (full lifecycle, concurrency, outages, emergencies, correlation IDs) is a working, runnable example of exactly the request/response shapes above.

## P. Example payloads — a complete call, start to finish

```bash
# 1. Call connects
curl -X POST https://voice-orchestrator.internal/v1/conversations \
  -H "Authorization: Bearer $ORCHESTRATOR_SERVICE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "tenantId": "11111111-1111-1111-1111-111111111111",
    "businessId": "22222222-2222-2222-2222-222222222222",
    "callId": "33333333-3333-3333-3333-333333333333",
    "callerAni": "+15551234567",
    "toNumber": "+15559876543",
    "timezone": "America/Chicago"
  }'
# -> 201, save response.id as CONV_ID, speak response.greeting BEFORE
#    doing anything else — see §C.1/§J, this step didn't exist before
#    and its absence was this build's single most serious found-live bug

# 2. Caller speaks, STT finalizes "Hi, my water heater is leaking"
curl -X POST https://voice-orchestrator.internal/v1/conversations/$CONV_ID/turns \
  -H "Authorization: Bearer $ORCHESTRATOR_SERVICE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "tenantId": "11111111-1111-1111-1111-111111111111",
    "idempotencyKey": "44444444-4444-4444-4444-444444444444",
    "transcript": "Hi, my water heater is leaking",
    "sttConfidence": 0.94,
    "offsetMs": 3200,
    "allowedTools": ["searchCustomer", "createCustomer", "createLead", "getBusinessHours", "getServiceAreas", "escalateEmergency", "lookupPreviousCalls", "updateLead"]
  }'
# -> 200, speak response.responseText

# 3. Call ends
curl -X POST https://voice-orchestrator.internal/v1/conversations/$CONV_ID/end \
  -H "Authorization: Bearer $ORCHESTRATOR_SERVICE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "tenantId": "11111111-1111-1111-1111-111111111111", "endReason": "caller_hangup" }'
# -> 200
```

## Q. What you never need to build or know about

Per this platform's architecture rules, none of the following are your concern and none of them are reachable from this contract: PostgreSQL, Prisma, Housecall Pro's API, lead/customer creation logic, scheduling/dispatch (there is no scheduling tool anywhere in this system — verified directly, see [27](27-phase10-runtime-integration-e2e.md) §1), notification delivery, or CRM sync. Your runtime's entire surface with this platform is the six endpoints in §A, text in, text out.
