# 33 — Emergency / SIP Live Verification Runbook

The emergency-transfer path is the single highest-stakes untested flow in this system: a failure here means a real emergency caller does not reach a human. This document exists specifically so a "successful" simulated transfer is never mistaken for a real one — nothing here should be marked passing without a literal, real transfer attempt.

## The flow being verified

```
Caller describes emergency
     ↓
escalateEmergency tool call (model-initiated, not runtime-initiated)
     ↓
EscalateEmergencyUseCase evaluates against EmergencyRule set
  (or DEFAULT_EMERGENCY_KEYWORDS fallback, fail-safe-toward-escalation
  on any internal error — docs/07 §5.2, unchanged since Phase 7)
     ↓
Tool result: { escalated: true, action: "forward_call", ... }
     ↓
Signal reaches Yash's runtime via the turn response
     ↓
Yash's runtime executes the ACTUAL SIP transfer/call-forward
  (this backend never places or transfers calls itself — docs/28 §M)
     ↓
Notification fires (urgency reflected)
     ↓
Human answers (or doesn't — see scenario 3 below)
```

Everything above the "Yash's runtime executes the actual SIP transfer" line is proven by the existing test suite (structural detection, escalation logic, notification consolidation — all covered in Phases 7 and 10). Everything from that line down has **never been tested against live telephony** in this project's history. This document is specifically about that gap.

## Test scenarios

### 1. Transfer succeeds

**Setup**: a live call, an emergency-triggering utterance, a real (or realistic test) destination number that will actually answer.
**Expected**: caller is connected to the destination number; call audio flows both directions after transfer.
**Evidence required**: a call recording or carrier-level log confirming the transfer connected, plus the internal `escalateEmergency` tool result and notification content.
**Do not mark PASS** based on the tool result alone — the tool result only proves this backend correctly _signaled_ the transfer, not that the transfer _happened_.

### 2. Transfer fails

**Setup**: same as #1, but the transfer mechanism itself fails (bad destination number, SIP trunk error, etc. — provoke this deliberately in a controlled test, don't wait for a real failure).
**Expected**: document what actually happens to the caller — does the runtime retry, play a fallback message, or drop the call? This behavior is entirely Yash's runtime's responsibility and is currently undefined/unverified from this repo's side.
**Evidence required**: the actual caller-facing behavior on transfer failure, captured directly.

### 3. Human does not answer

**Setup**: transfer succeeds mechanically but nobody picks up.
**Expected**: document the actual fallback (voicemail? ring timeout then retry a different number? nothing?) — again, Yash's runtime's responsibility, currently unverified.
**Evidence required**: actual observed behavior.

### 4. Caller hangs up during/after escalation

**Setup**: caller disconnects before or during the transfer attempt.
**Expected**: `POST /:id/end` still reaches this backend (or doesn't, if the disconnect happens runtime-side without ever notifying the orchestrator — also worth confirming); the `Lead`/notification state reflects whatever happened up to that point, not a phantom "call completed successfully" state.
**Evidence required**: actual call-end sequence and resulting database state.

### 5. Notification fails during an emergency

**Setup**: the notification channel (SMS/webhook) is unreachable at the moment of escalation.
**Expected**: per the existing Dead Letter Queue mechanism (Phase 7, unchanged) — the notification is retried/surfaced as failed rather than silently dropped. This part IS testable without live telephony (it's a core-api-side mechanism) and should be verified as its own sub-test before attempting the full live scenario.
**Evidence required**: DLQ entry showing the failed send, confirmation it's surfaced somewhere reviewable (not silently lost).

### 6. Duplicate emergency event

**Setup**: the same emergency condition is signaled twice in quick succession (e.g., a runtime retry of the turn that triggered `escalateEmergency`).
**Expected**: per the Tool Broker's idempotency stage, the second call either replays the cached result or is recognized as the same logical event — no duplicate transfer attempt, no duplicate notification.
**Evidence required**: both tool-call results, confirmation only one notification/transfer attempt occurred.

## What must be tested on the real telephony system specifically

Scenarios 1-4 above categorically cannot be verified any other way — they depend on Yash's runtime's actual SIP/telephony transfer implementation, which doesn't exist in this repository and cannot be simulated meaningfully (a simulated "transfer succeeded" boolean proves nothing about whether a real phone actually rang). Scenarios 5-6 can be partially pre-verified using the existing simulator (notification DLQ behavior, tool-call idempotency) before ever touching live telephony — recommended to do so first, since they're the cheaper, faster-feedback parts of this checklist.

## After running all 6

Update [docs/29](29-phase11-12-blocker-resolution.md) Blocker 4's status. This blocker should not be marked 🟢 GREEN on the strength of scenarios 5-6 alone (those only prove the notification/idempotency layer, which was already proven in Phase 10) — it requires literal evidence from scenarios 1-4 against real telephony.
