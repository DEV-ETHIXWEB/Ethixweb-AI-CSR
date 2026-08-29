# 41 — First Local Real Call Runbook

Step-by-step runbook for the first real inbound phone call through the
complete pipeline, now that `apps/voice-runtime` exists (Phase 15B) and
docs/39's "the actual voice runtime does not exist yet" blocker is closed.

**Status of this document: none of the 22 steps below have been executed
in this environment.** No Twilio account, Deepgram key, or ElevenLabs key
is available here — this is the runbook for Akash to execute, not a record
of a call that already happened. This follows the same convention as
docs/31 and docs/39: every claim below is either something the automated
test suites in this repo actually verified (cited explicitly), or a step
marked as requiring live execution. Do not mark any step below as passed
without actually running it and capturing evidence.

## What IS verified, without a live call

- `apps/voice-orchestrator`'s six-endpoint contract: 161 unit tests + 35
  e2e tests (`pnpm --filter @ethixweb/voice-orchestrator run test:unit` /
  `test:e2e`), including the new `escalation` field added in this phase.
- `apps/voice-runtime`'s own logic — turn retry/idempotency, both barge-in
  mechanisms, capacity-429 handling, emergency transfer triggering, TwiML
  generation, Twilio signature verification, tenant routing — against
  hand-written fakes for Twilio/Deepgram/ElevenLabs/voice-orchestrator: 51
  unit tests (`pnpm --filter @ethixweb/voice-runtime run test:unit`) + 9
  scripted scenarios (`pnpm --filter @ethixweb/voice-runtime run test:e2e`)
  covering normal conversation, interruption, duplicate turn, provider
  timeout, provider failure, orchestrator failure, caller disconnect,
  emergency, and capacity rejection.
- What is explicitly **not** verified by any of the above: real Twilio
  webhook delivery/signature format, real Deepgram/ElevenLabs WebSocket
  protocol behavior (built against public docs, flagged `[Unverified]` in
  the adapters themselves — see `deepgram-stt.provider.ts` and
  `elevenlabs-tts.provider.ts`), real audio quality/latency, and the actual
  Twilio call-transfer REST call.

## Pre-call checklist (each step gates the next)

1. **PostgreSQL and Redis running** — whatever this repo's existing local
   setup already uses (docs/39 §"Local services that must run" — unchanged
   by this phase).
2. **core-api boots cleanly**: `pnpm --filter @ethixweb/core-api run start:dev`
   (port 3000). Confirm `GET http://localhost:3000/healthz` returns 200.
3. **voice-orchestrator boots cleanly**:
   `pnpm --filter @ethixweb/voice-orchestrator run start:dev` (port 3100).
   Confirm `GET http://localhost:3100/healthz` returns 200. A missing
   required env var crashes bootstrap immediately with a zod error message
   (`env.schema.ts`) — a clean boot is itself partial evidence this step
   passed.
4. **A tenant/business exists** in the target database with business
   hours, service areas, and at least one `EmergencyRule` configured
   (existing tenant-provisioning flow, unchanged by this phase).
5. **HCP configured** for the test tenant if lead handoff to a real CRM is
   part of this test — see docs/32. If not configured, `createLead` still
   succeeds (core-api's own CRM adapter behavior, not something this phase
   changes) but nothing lands in a real HCP account.
6. **Notification channel configured** for the test tenant (SMS and/or
   webhook) so a created lead actually produces a visible notification.
7. **`apps/voice-runtime`'s `.env` populated** — copy `.env.example`, fill
   in every required var (see "Required credentials" below). A missing
   required var crashes this service's own bootstrap the same way (§3).
8. **voice-runtime boots cleanly**:
   `pnpm --filter @ethixweb/voice-runtime run start:dev` (port 3200).
   Confirm `GET http://localhost:3200/healthz` returns 200.
9. **`ORCHESTRATOR_SERVICE_TOKEN` matches exactly** between
   `apps/voice-orchestrator/.env` and `apps/voice-runtime/.env` — a shared
   secret, not independently generated per service. Confirm with a manual
   `curl -X POST http://localhost:3100/v1/conversations -H "Authorization: Bearer $TOKEN" ...`
   using voice-runtime's copy of the token; expect a real response, not 401.
10. **TENANT_ROUTING_DEFAULT_TENANT_ID/\_BUSINESS_ID set** in voice-runtime's
    `.env` to the tenant/business from step 4 (the single-tenant mode —
    see `.env.example`'s own comment; a multi-number `TENANT_ROUTING_MAP`
    is unnecessary for a first test with one number).
11. **Expose voice-runtime via HTTPS tunnel**: `ngrok http 3200` (or
    Cloudflare Tunnel). Copy the resulting `https://` URL into
    `PUBLIC_BASE_URL` in voice-runtime's `.env`, then restart voice-runtime
    so `TwilioSignatureGuard` reconstructs the correct URL. **ngrok's
    free-tier URL changes every restart** — this is the single most common
    "why didn't anything happen" cause per docs/39; re-check this every
    session.
12. **Configure the Twilio phone number's webhook**: in the Twilio Console,
    under the number's **Voice → "A call comes in"** setting, set the
    webhook to `<PUBLIC_BASE_URL>/webhooks/twilio/voice`, HTTP POST. Use a
    **dedicated test number**, not a shared staging/production number
    (docs/39's own separation-of-credentials guidance, unchanged).

## The call itself

13. **Call the Twilio number from a real phone** (an Indian phone calling a
    Twilio US/international number works — Twilio bills this as a normal
    inbound call to whatever number was purchased; no special
    international configuration is needed on voice-runtime's side beyond
    Twilio's own number being reachable from India, which is a Twilio
    account/number-type property to confirm in the Twilio Console before
    this step, not something this codebase controls).
14. **Watch voice-runtime's logs** for the inbound webhook hit
    (`TwilioVoiceController.voice`) — confirm `X-Twilio-Signature`
    verification passed (no 403) and the TwiML response was returned.
15. **Confirm the Media Stream WebSocket connects**: voice-runtime's logs
    should show `media stream started` shortly after the webhook response,
    with a real `callSid`/`streamSid`. If this doesn't happen, the most
    likely cause is `PUBLIC_BASE_URL`'s `wss://` host not matching the
    live ngrok tunnel (step 11).
16. **Confirm STT**: speak into the phone; voice-runtime's logs should show
    a finalized transcript reaching `handleFinalTranscript` shortly after
    you stop speaking (Deepgram's `speech_final`, ~300ms endpointing delay
    by default — see `deepgram-stt.provider.ts`).
17. **Confirm the turn reaches voice-orchestrator**: voice-orchestrator's
    logs should show `POST /v1/conversations/:id/turns` with the
    transcript you spoke; confirm `callId`/`conversationId` correlate
    across both services' logs (docs/28 §F).
18. **Confirm you hear a spoken response** — ElevenLabs synthesis reaching
    your phone as audible speech. This is the single highest-latency,
    highest-risk untested path in the whole chain (STT round-trip + LLM
    completion + TTS round-trip, all over a live phone connection) — note
    the actual end-to-end latency you experience.
19. **Describe a plumbing/HVAC service need** when asked, through to
    `createLead` firing — confirm in core-api's logs/database that
    `searchCustomer` ran first, then (for a new caller) `createCustomer`,
    then `createLead`.
20. **If HCP credentials are configured for the test tenant (step 5)**,
    confirm the lead actually appears in the HCP account — this is
    core-api's existing, already-tested CRM sync path (docs/40), not new
    behavior from this phase; this step only confirms the credentials for
    THIS specific tenant are live.
21. **Hang up** (either end) and confirm: voice-runtime's logs show the
    Twilio `stop` event and a call to `POST /v1/conversations/:id/end`;
    voice-orchestrator's logs show the conversation transitioning to
    `ended`; core-api emits a `voice_call_duration` usage-metering event
    (already tested, docs/24 §Phase 10).
22. **Check the dashboard** (`localhost:3001/admin/overview`) — confirm
    `callsToday`/`leadsCapturedToday` reflect the real call. Per docs/39's
    own caveat, this reads Postgres-derived data after the fact
    (near-real-time, not a live feed) — allow a few seconds before
    checking.

## Optional: emergency transfer test (separate, higher-risk)

Only attempt after the 22 steps above have passed cleanly at least once.
Describe a configured emergency condition (e.g., "there's a burst pipe
flooding my basement right now"). Confirm `escalateEmergency` fires
(core-api logs), the turn response carries `escalation: {action:
"forward_call"}` (voice-orchestrator logs — the field this phase added),
and `EMERGENCY_TRANSFER_NUMBER` actually rings. **This exercises
`TwilioCallTransferProvider`, which is `[Unverified against a live Twilio
account]`** per its own code comment — do not treat a clean run through
steps 1-22 as evidence this path also works; test it explicitly, and do
not use a real emergency line as `EMERGENCY_TRANSFER_NUMBER` for this
test.

## Required credentials

| Variable                                                                                                                                                                                                        | Where to get it                                                                         | Voice-runtime env var                                           |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Twilio Account SID + Auth Token                                                                                                                                                                                 | Twilio Console dashboard (console.twilio.com)                                           | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`                       |
| Twilio phone number                                                                                                                                                                                             | Twilio Console → Phone Numbers (buy or use an existing one)                             | `TWILIO_PHONE_NUMBER`, and the number's Voice webhook (step 12) |
| Deepgram API key                                                                                                                                                                                                | console.deepgram.com → API Keys                                                         | `DEEPGRAM_API_KEY`                                              |
| ElevenLabs API key + voice ID                                                                                                                                                                                   | elevenlabs.io → Profile Settings (key), Voice Library or a cloned voice (voice ID)      | `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`                     |
| voice-orchestrator's service token                                                                                                                                                                              | Generated locally (`openssl rand -base64 48`), set identically in both services' `.env` | `ORCHESTRATOR_SERVICE_TOKEN`                                    |
| HCP credentials (optional, for step 20)                                                                                                                                                                         | See docs/32-hcp-live-verification-checklist.md                                          | Not a voice-runtime var — stored per-tenant in core-api         |
| Emergency transfer destination (**required for voice-runtime to boot at all**, not just for the emergency test above — env.schema.ts's own `validate()` refuses to start without it or `HUMAN_FALLBACK_NUMBER`) | A real on-call number/queue you control for testing                                     | `EMERGENCY_TRANSFER_NUMBER`                                     |

## Local run commands (all four services)

```bash
# Terminal 1 — core-api
pnpm --filter @ethixweb/core-api run start:dev

# Terminal 2 — voice-orchestrator
pnpm --filter @ethixweb/voice-orchestrator run start:dev

# Terminal 3 — voice-runtime
pnpm --filter @ethixweb/voice-runtime run start:dev

# Terminal 4 — dashboard (optional, for step 22 only)
pnpm --filter @ethixweb/dashboard run start:dev

# Terminal 5 — tunnel (step 11)
ngrok http 3200

# Or, once all four services' .env files are populated, from the repo root:
pnpm dev
```

## After the call

Update this document's "Status" line with what was actually run and what
passed/failed, following docs/31's own convention — fill in real captured
evidence (log excerpts, actual latency observed, whether the caller could
understand the AI clearly), not a checkmark with no evidence behind it.
