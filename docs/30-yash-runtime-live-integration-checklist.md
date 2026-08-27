# 30 — Yash Runtime: Live Integration Checklist

This is a practical checklist, not a second contract document — [docs/28](28-yash-runtime-integration-package.md) is and remains the source of truth for every request/response shape, field, endpoint, and rule below. Nothing here invents anything docs/28 or [docs/24](24-runtime-orchestrator-contract.md) doesn't already state; this file exists to turn that contract into a literal checklist with responsibility clearly assigned, for the moment a live runtime is ready to connect.

## Responsibility split

### YASH'S RESPONSIBILITY (runtime side)

- [ ] Telephony provider integration (Twilio/LiveKit/SIP/whatever is chosen) — entirely his own stack, this platform has no opinion on it.
- [ ] STT integration — buffering partial transcripts, only sending finalized ones (docs/28 §B.2).
- [ ] TTS integration — synthesizing `responseText` from turn responses.
- [ ] Generating `callId` (UUID) once per call and persisting it across his own process's lifetime for that call (docs/28 §B.1).
- [ ] Generating a fresh `idempotencyKey` per turn _attempt_, reusing the same key on retry of the same attempt (docs/28 §B.2, §G — "the single most important integration detail").
- [ ] Resolving `tenantId`/`businessId` from the dialed number (`toNumber`) before calling `POST /conversations` — this mapping is telephony-provisioning configuration his runtime owns, not something this backend computes (docs/28 §B.1).
- [ ] Implementing the actual SIP transfer when `escalateEmergency` returns `action: "forward_call"` (docs/28 §M) — this backend only signals, never executes, a transfer.
- [ ] Both barge-in mechanisms: aborting an in-flight turn HTTP call directly, AND calling `POST /:id/interrupt` for the between-turns case (docs/28 §B.3, docs/24 §2.3 — "not redundant, a real integration needs both").
- [ ] Deciding what to do if `POST /conversations` fails at call-start (docs/28 §J step 2) — fallback routing, a static apology clip, etc. This is explicitly his production decision, not something this backend can make for him.
- [ ] Storing/matching the shared `ORCHESTRATOR_SERVICE_TOKEN` in his runtime's own config.

### ETHIXWEB REPOSITORY RESPONSIBILITY (already built, Phases 6-10)

- [x] The 6 HTTP endpoints, fully implemented and tested (docs/24 §2).
- [x] Turn idempotency enforcement server-side (Redis-backed, `IdempotencyStore`).
- [x] Call-start idempotency (`SET NX` on `(tenantId, callId)`).
- [x] Auth enforcement (`ServiceAuthGuard`, constant-time comparison, fails closed).
- [x] Tenant re-validation on every request (wrong `tenantId` → `404`, never cross-tenant data).
- [x] The conversation state machine, LLM/tool loop, Tool Broker 6-stage pipeline.
- [x] `Call` row creation before conversation creation (the FK-ordering guarantee).
- [x] Customer search-before-create, lead creation, emergency detection logic, notification consolidation — all internal, none of it is Yash's concern.
- [x] `voice_call_duration` usage-metering emission on call end.
- [ ] **Not yet built**: `findByCallId` exposed as an HTTP route (docs/28 §I's known, deliberate gap) — only needed if Yash's runtime process model can crash/restart mid-call without retaining in-memory `conversationId`. Confirm with Yash whether this applies to his architecture before treating it as blocking.

### EXTERNAL PROVIDER RESPONSIBILITY (neither side owns this)

- [ ] Actual telephony carrier/SIP trunk uptime and call quality.
- [ ] STT/TTS vendor accuracy, latency, and availability.
- [ ] LLM provider (OpenAI/Anthropic/Gemini) availability — already abstracted behind a fallback chain on this backend's side, but the vendors themselves are external.

## Practical checklist for the live connection itself

- [ ] `ORCHESTRATOR_SERVICE_TOKEN` generated and set identically in both Yash's runtime config and this deployment's environment (out-of-band secret exchange — never send it over an API call, never commit it).
- [ ] `voice-orchestrator`'s base URL is reachable from wherever Yash's runtime runs (network/firewall/VPN as needed).
- [ ] Environment variables confirmed present on the `voice-orchestrator` side (`REDIS_URL`, `CORE_API_BASE_URL`, `CORE_API_SERVICE_API_KEY`, `ORCHESTRATOR_SERVICE_TOKEN` — all required at boot per `env.schema.ts`, confirmed by direct read).
- [ ] Tenant/business identity mapping (`toNumber` → `tenantId`/`businessId`) is provisioned for at least one real or test business.
- [ ] `telephonyCallSid`/`callId`/`conversationId`/turn `idempotencyKey`s are all logged on Yash's side per call, per docs/28 §F, so a call is traceable end-to-end from his logs alone.

## Sequences (copied in summary from docs/28 — that document is authoritative; read it in full before implementing)

- **Call start** — docs/28 §J: generate `callId` → `POST /conversations` (blocking, must succeed) → save `conversationId`.
- **Turn** — docs/28 §K: STT finalizes → generate `idempotencyKey` → `POST /:id/turns` → speak `responseText`.
- **Interrupt** — docs/28 §B.3: only when no turn request is in flight; otherwise abort the in-flight request directly.
- **Call end** — docs/28 §L: `POST /:id/end`, best-effort side effects internally, safe to call twice.
- **Emergency** — docs/28 §M: the model detects it via `escalateEmergency`, not the runtime; `action: "forward_call"` in the tool result is Yash's signal to execute the actual transfer.

## Error handling reference

See docs/28 §N for the full table (400/401/404/409/5xx and the correct action for each). Not reproduced again here to avoid the two documents drifting out of sync — read it there.

## When this checklist is fully checked

That's the point at which [docs/29](29-phase11-12-blocker-resolution.md) Blocker 1 can move from 🔴 RED to 🟡 YELLOW (connected, not yet verified) and then 🟢 GREEN once [docs/31](31-first-real-phone-call-runbook.md)'s Test Call #1 actually passes with captured evidence.
