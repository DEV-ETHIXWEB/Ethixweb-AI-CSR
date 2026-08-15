# 39 — Local Twilio Testing Runbook (preparation, not yet executable)

This is a developer runbook for the eventual first real inbound call test, written now so the steps are ready the moment they become possible. **It does not describe working functionality today** — confirmed by direct audit before writing this: no Twilio Voice webhook route exists anywhere in this repository (only the unrelated `TwilioSignatureGuard`/`twilio-sms.sender.ts` for outbound SMS notifications, a completely different feature). The actual voice runtime — the thing a Twilio Voice webhook would need to reach — is Yash's, external to this repo, and does not exist yet (docs/29 Blocker 1). This document is preparation, not a claim that local Twilio testing works today.

## The intended chain

```
Real US Twilio number (yours)
        ↓ inbound call
Twilio Voice webhook (Twilio's servers call OUT to a URL you configure)
        ↓ HTTPS
Public tunnel (e.g. ngrok) — exposes your local machine to the internet
        ↓
Yash's voice runtime (NOT YET BUILT — this is the actual blocker)
        ↓ HTTP, per docs/28's contract
voice-orchestrator (localhost:3100)
        ↓ HTTP
core-api (localhost:3000)
        ↓
PostgreSQL + Redis
        ↓ (separately, for visibility only — not in the live call path)
dashboard (localhost:3001) — for watching leads/calls appear after the fact
```

**The dashboard is not part of the live call path.** It reads Postgres-derived data after the fact (docs/37 §4's own honest caveat — near-real-time, not a live feed) — nothing about a real call depends on the dashboard being open or even running.

## What's genuinely blocked vs. what can be prepared now

🔴 **Cannot be tested until Yash's runtime exists**: anything past "Twilio dials your number" — there is no code anywhere in this repo that a Twilio Voice webhook could point at and get a sensible response from. Pointing a real Twilio number's Voice webhook at this repo's `voice-orchestrator` directly would fail, because `voice-orchestrator`'s contract (docs/24, docs/28) is deliberately telephony-concept-free JSON (`POST /v1/conversations`, `{tenantId, businessId, callId, callerAni, ...}`) — it has no route that understands Twilio's own webhook payload format (TwiML, `CallSid`, etc.) at all. That translation layer is exactly what Yash's runtime is.

🟢 **Can be prepared/verified now**: local services boot correctly, ports are correct, tunnel setup works, environment variable separation is documented, and the dashboard correctly shows data once a call exists in Postgres (which can be verified today via the existing e2e simulator or manual API calls, without any real Twilio call).

## Required environment variables (once the runtime exists)

None of these exist as _voice_-specific config in this repo today — they belong to Yash's runtime, not to `core-api`/`voice-orchestrator`. Documented here so they're not forgotten when that integration begins:

| Variable                                        | Purpose                                                                                                    | Where it would live                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `TWILIO_ACCOUNT_SID`                            | Twilio account identifier                                                                                  | Yash's runtime's own config — never this repo                                                                                                                                                                                                                                                                                                                                              |
| `TWILIO_AUTH_TOKEN`                             | Twilio's signing secret, for verifying inbound webhook authenticity                                        | Yash's runtime's own config. **A same-named var already exists in this repo's `.env.example`** (`.env.example:60`) — that one is for the unrelated outbound-SMS-notification feature (`TwilioSignatureGuard`, `twilio-sms.sender.ts`). Do not reuse core-api's copy for voice; they are different Twilio use cases and should use separate credentials even if both happen to be "Twilio." |
| `ORCHESTRATOR_SERVICE_TOKEN`                    | Shared secret between Yash's runtime and `voice-orchestrator`                                              | Already exists in this repo (`.env.example`) — Yash's runtime needs the identical value, provisioned out-of-band, never committed                                                                                                                                                                                                                                                          |
| `CORE_API_BASE_URL`, `CORE_API_SERVICE_API_KEY` | Already exist — `voice-orchestrator`'s own config, unrelated to Twilio directly but part of the same chain | Already documented in docs/25                                                                                                                                                                                                                                                                                                                                                              |

## Local services that must run

For anything below the "Yash's runtime" line in the chain above to be testable today (i.e., everything except a real inbound call):

```bash
# Terminal 1 — core-api (port 3000)
pnpm --filter @ethixweb/core-api run start:dev

# Terminal 2 — voice-orchestrator (port 3100)
pnpm --filter @ethixweb/voice-orchestrator run start:dev

# Terminal 3 — dashboard (port 3001)
pnpm --filter @ethixweb/dashboard run start:dev

# Redis and PostgreSQL — per docs/34's staging checklist; locally, whatever
# you already have running for this repo's existing dev setup (no new
# requirement introduced by this runbook).
```

Ports are the real configured defaults (`apps/core-api/src/shared/config/env.schema.ts` → `PORT` default `3000`; `apps/voice-orchestrator/src/shared/config/env.schema.ts` → `PORT` default `3100`; `apps/dashboard/package.json`'s `start:dev` → `next dev --port 3001`) — not invented for this document.

## How to expose a webhook safely once Yash's runtime exists

1. Run Yash's runtime locally on whatever port it uses.
2. Run `ngrok http <that port>` (or an equivalent tunnel — Cloudflare Tunnel, etc.) — this gives a temporary public HTTPS URL forwarding to your local machine.
3. In the Twilio Console, set your phone number's **Voice → "A call comes in"** webhook to that ngrok URL.
4. Call the Twilio number from a real phone.
5. **Never leave a tunnel open longer than the test session** — ngrok's free-tier URLs are public and unauthenticated by default; anyone who discovers the URL could hit your local runtime while it's exposed.

## Where the Twilio webhook eventually points

**Yash's runtime**, not `voice-orchestrator` or `core-api` directly. Neither of those two services in this repo has (or should have) a route shaped for Twilio's own webhook payload — that translation is architecturally Yash's runtime's job, per the platform's own design (docs/24 §intro: the Voice Runtime exists specifically so telephony concepts never leak into the orchestrator's contract).

## How to test an inbound call (once possible)

1. Confirm all local services (§ above) are running and healthy (`GET /healthz` on both core-api and voice-orchestrator).
2. Confirm Yash's runtime is running and its tunnel is live.
3. Confirm the Twilio number's webhook points at the current tunnel URL (ngrok URLs change every restart on the free tier — a stale URL is the single most common "why didn't anything happen" cause).
4. Call the number from a real phone.
5. Watch `voice-orchestrator`'s logs for `POST /v1/conversations` — this is the first point this repo's own code becomes involved.
6. After the call ends, check the dashboard's Overview page (`localhost:3001/admin/overview`) — `callsToday`/`leadsCapturedToday` should reflect the real call once core-api's `POST /internal/calls` and downstream writes have landed.

## Keeping LOCAL / STAGING / PRODUCTION credentials separated

- Use **separate Twilio phone numbers** per environment if possible — a single number's webhook can only point at one place at a time, so local dev testing against a shared staging/production number risks staging traffic vanishing into a developer's laptop.
- `ORCHESTRATOR_SERVICE_TOKEN` and `CORE_API_SERVICE_API_KEY` must differ across local/staging/production (docs/34 §2 already states this for the existing services — the same discipline extends to whatever credentials Yash's runtime needs).
- Never commit real values for any of the variables in the table above. `.env` and `.env.*.local` are already gitignored (`.gitignore`, confirmed present) — this runbook introduces no new secret-handling requirement, it just extends the existing discipline to Yash's runtime once it exists.

## What remains explicitly untestable until Yash's runtime exists

Everything past "a tunnel can reach your machine": real STT, real AI response synthesis reaching a real caller, real barge-in, real emergency SIP transfer, real call-quality/latency measurement. This is unchanged from docs/29/docs/31's own accounting — this runbook does not close that gap, it only prepares the surrounding infrastructure so the gap is the _only_ remaining blocker when Yash's runtime is ready.
