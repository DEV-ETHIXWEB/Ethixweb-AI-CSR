# 27 — Phase 10: Real Runtime Integration & End-to-End Call Flow

As-built documentation for what this phase actually changed — not a new architecture proposal. Phase 10's mandate was narrow and explicit: connect the pieces Phases 1-9 already built and prove the whole chain (Voice Runtime → Voice Orchestrator → core-api → PostgreSQL → human handoff) works as one coherent system. The pre-implementation audit (recorded in full in this phase's own session transcript) found the vast majority of that chain **already production-capable** — this phase's actual code changes are small and precisely scoped to the confirmed gaps, not a rebuild.

## 1. What was already production-capable before this phase touched anything

Confirmed by direct inspection, not assumption, before writing any code:

- The full runtime contract ([24-runtime-orchestrator-contract.md](24-runtime-orchestrator-contract.md)): start/turn/interrupt/end/get/transcript, all authenticated, all validated, all idempotent where required.
- The Call-persistence FK ordering guarantee (the immediately-prior commit, `74cbd09`).
- The Tool Broker's 6-stage pipeline — structural, not conventional, enforcement that only registered tools can ever execute.
- **Zero scheduling capability anywhere in the 8-tool catalog** — confirmed by reading `tool-catalog.ts` directly, not inferred from documentation.
- `ResolveCustomerUseCase` — phone-first cache-then-CRM customer matching, no fuzzy auto-merge.
- `EscalateEmergencyUseCase` — tenant-configured rules with a documented default keyword fallback and a fail-safe-toward-escalation default on any internal error.
- `SendLeadNotificationUseCase` — one `lead.created` outbox event drives exactly one notification per configured channel, from one canonical `NotificationPayload`, with per-channel dedup and a Dead Letter Queue.
- `ClaimLeadUseCase` — race-safe exclusive claiming via a real `UNIQUE(lead_id)` constraint.
- The platform base prompt (`prompt-layers.ts`) already encodes, verbatim: never schedule, never quote a price, tool-only capability surface, always confirm spelled names/addresses, defer emergency judgment to `escalateEmergency`.
- A working runtime simulator (`apps/voice-orchestrator/test/voice-runtime-simulator.ts` + `runtime-contract.e2e.spec.ts`) — built in Phase 8, driving the real Nest module graph over real HTTP via Fastify's `.inject()`. This **is** the contract-test harness this phase's own brief asked for; it did not need to be built from scratch, only extended.

## 2. What this phase actually built

Two things, both confirmed missing by direct inspection:

### 2.1 Usage-metering wiring (`voice_call_duration` only)

`EndConversationUseCase` now emits one `voice_call_duration` usage event to `POST /internal/usage` (docs/26's already-built ingestion endpoint) on every call end — best-effort, non-blocking, matching the exact pattern already established for ending the `Call` row in the same method. `dedupKey` follows docs/26 §8's own recommended convention (`${conversationId}:voice_call_duration:final`), so a Voice Runtime retry of the end-call signal can never double-count.

**Deliberately not metered, and documented honestly rather than faked**: `llm_tokens`, `stt_duration`, `tts_characters`. None of that data exists anywhere in this codebase today — `AiCompletionChunk` (the streaming type all three provider adapters implement) reports no token counts from any vendor, and STT/TTS metrics can only ever come from a real Voice Runtime, which does not exist in this repository. Wiring those dimensions would require a genuine protocol extension (a new field on `AiCompletionChunk`'s `"done"` variant, plus updates to all three adapters to parse each vendor's own usage-reporting format) — confirmed as a real, separate follow-up task during this phase's audit, not something to fabricate partial coverage for.

### 2.2 Extended the existing runtime simulator with the scenarios the audit found missing

`apps/voice-orchestrator/test/runtime-contract.e2e.spec.ts` gained 9 new tests, in 6 new `describe` blocks, covering exactly the gaps the pre-implementation audit identified (concurrent duplicate call-start, concurrent duplicate turns, core-api outage tolerance at two different points with two different — and both correct — outcomes, early hangup before and after lead creation, the no-scheduling-capability guarantee, correlation-ID propagation, and usage-metering emission). None of these required new production code beyond §2.1 — they are proofs of existing behavior, and every one of them passed against the real implementation on the first correctly-written attempt (one test needed a correction to its own expectation, documented in §5).

`apps/core-api/src/modules/notifications/application/send-lead-notification.use-case.spec.ts` gained one test proving the specific HCP failure mode this platform exists to fix: every channel receives content derived from the identical canonical payload (not independently-drifting per-channel content), and a second invocation for the same lead sends nothing further.

## 3. Architecture boundary — verified unchanged

```
Voice Runtime (Twilio/LiveKit/STT/TTS — Yash's runtime, external to this repo)
     ↓ HTTP only
Voice Orchestrator (conversation reasoning, Tool Broker, AI provider abstraction)
     ↓ HTTP only, via CoreApiClientPort
core-api (Calls, Customers, Leads, Emergency Rules, Notifications, Usage — PostgreSQL)
```

No line of this phase's code crosses these boundaries. `voice-orchestrator` still has zero PostgreSQL/Prisma dependency (`RedisService`'s own comment, unchanged). `core-api` remains the only thing that ever touches the database or the Housecall Pro adapter. The Tool Broker's registry still contains exactly 8 tools, none of them scheduling-capable — verified again, directly, in this phase (§2.2's no-scheduling-capability test), not merely re-asserted from memory of the Phase 8 audit.

## 4. Test additions summary

| File                                                                                             | New tests | What they prove                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/voice-orchestrator/src/modules/conversation/application/end-conversation.use-case.spec.ts` | 4         | Usage-metering emission, correct quantity, `leadId` omitted when absent, best-effort failure tolerance, no double-emission on idempotent replay                                      |
| `apps/voice-orchestrator/test/runtime-contract.e2e.spec.ts`                                      | 9         | Concurrent duplicate call-start/turn, core-api outage (both points), early hangup (both points), no-scheduling-capability, correlation-ID propagation, usage-metering over real HTTP |
| `apps/core-api/src/modules/notifications/application/send-lead-notification.use-case.spec.ts`    | 1         | Consolidated (not fanned-out-and-drifting) notification content, anti-duplicate-callback on re-invocation                                                                            |

## 5. A real finding worth carrying forward: `toolCallsExecuted` naming

While writing the no-scheduling-capability test, found that `HandleTurnUseCase.toolCallsExecuted` records every tool name the **model requested** that turn (pushed before `runTool` is even attempted), not only tools that **actually executed**. A rejected tool call (unknown/unauthorized) still appears in this array. This is not a guardrail weakness — the tool is correctly never executed, `ExecuteToolUseCase`'s registry lookup fails closed, and no HTTP call to core-api ever happens for it (confirmed directly: the test asserts exactly one `postCalls` entry, the `StartConversationUseCase` call, for the whole turn) — but the field name overclaims what it measures. Left unchanged in this phase (a naming/observability precision issue, not a functional gap, and renaming a response-DTO field is a breaking contract change outside this phase's narrow mandate) — flagged here for whoever next touches `HandleTurnUseCase`/`TurnResultResponseDto`.

## 6. What remains genuinely untestable without Yash's live runtime

Unchanged from docs/24 §4/§8's own honest accounting, reconfirmed during this phase's audit: real STT/TTS latency, real barge-in timing under live audio, real SIP transfer behavior for `escalateEmergency`'s `forward_call` action, real Twilio/LiveKit failure modes. See [28-yash-runtime-integration-package.md](28-yash-runtime-integration-package.md) for the concrete handoff.
