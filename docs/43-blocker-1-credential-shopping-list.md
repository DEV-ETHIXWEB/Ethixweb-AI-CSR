# 43 — Blocker 1 Credential Shopping List

Everything needed to make the first real phone call, in one place.

[docs/29](29-phase11-12-blocker-resolution.md) Blocker 1 was written when the
voice runtime was somebody else's dependency. It isn't any more —
`apps/voice-runtime` is a real service in this repository (Phase 15B) and it
boots. Verified on 2026-08-30: it fails closed at bootstrap on exactly **six**
variables and nothing else. This document is the list of six.

## What to buy

| Variable              | Where from                                  | Cost                                   | Notes                                                                           |
| --------------------- | ------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------- |
| `TWILIO_ACCOUNT_SID`  | twilio.com console, top of dashboard        | —                                      | free with account                                                               |
| `TWILIO_AUTH_TOKEN`   | same page, click to reveal                  | —                                      | treat as a password                                                             |
| `TWILIO_PHONE_NUMBER` | Twilio → Phone Numbers → Buy a number       | ~$1–2/mo + ~$0.0085/min inbound        | **Voice capability required.** Use a dedicated test number, never a shared one. |
| `DEEPGRAM_API_KEY`    | console.deepgram.com → API Keys             | $200 free credit                       | streaming STT                                                                   |
| `ELEVENLABS_API_KEY`  | elevenlabs.io → Profile → API Key           | free tier exists; ~$5/mo realistically | streaming TTS                                                                   |
| `ELEVENLABS_VOICE_ID` | elevenlabs.io → Voices → pick one → copy ID | —                                      | not the voice _name_, the ID                                                    |

Realistic total for testing: **under $20.**

Also needed, not a credential:

- **ngrok** (or Cloudflare Tunnel) — Twilio must reach your laptop over HTTPS.
  Free tier is fine. Its URL changes on every restart, which per
  [docs/41](41-first-local-real-call.md) is the single most common
  "why did nothing happen" cause.
- **An LLM key** for voice-orchestrator — one of `OPENAI_API_KEY`,
  `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` in `apps/voice-orchestrator/.env`.
  Optional to boot, required for the AI to actually say anything.

## Where each value goes

All six go in `apps/voice-runtime/.env` (not the root `.env` — see the
README's "Which `.env`" section). Everything else in that file is already
filled in and verified working locally.

Two more in the same file need real values before a call:

- `PUBLIC_BASE_URL` — your ngrok HTTPS URL. Restart voice-runtime after
  changing it, or `TwilioSignatureGuard` reconstructs the wrong URL and
  rejects every webhook with a 403.
- `EMERGENCY_TRANSFER_NUMBER` — a real number you can answer. This is a
  boot-time requirement, not optional.

## Then

```bash
pnpm --filter @ethixweb/voice-runtime run start:dev
curl localhost:3200/healthz    # expect 200
```

A clean boot is itself partial evidence the credentials are well-formed —
bootstrap validates them. Then follow [docs/41](41-first-local-real-call.md)'s
22 steps and capture evidence per step. Do not mark a step passed without
running it.

## What this does not cover

Blocker 2 (Housecall Pro) is independent — a call works without it, the lead
just never reaches a real CRM. Blocker 4 (live SIP emergency transfer) needs
Blocker 1 done first and is deliberately last: it is the highest-stakes
untested path in the system.
