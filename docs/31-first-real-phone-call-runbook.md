# 31 — First Real Phone Call Runbook

Step-by-step, executable runbook for the first real (or first realistic staged) phone call through the full pipeline. Every test below defines INPUT, EXPECTED BEHAVIOR, EVIDENCE TO CAPTURE, and PASS/FAIL — fill these in with real captured output when actually run. This document does not claim any of these have been executed; it is the runbook for when they can be.

## PRE-CALL CHECKS

Run these in order — each one gates the next.

1. **Services running**: `core-api` and `voice-orchestrator` both boot cleanly (`pnpm --filter @ethixweb/core-api run start`, `pnpm --filter @ethixweb/voice-orchestrator run start`, or their staging equivalents). Confirm both processes are up and not crash-looping.
2. **Environment variables**: every required var in [docs/34](34-staging-environment-checklist.md)'s configuration matrix is set for both services — a missing one causes a boot-time crash with a clear zod error message (both apps' `env.schema.ts` validate at startup, confirmed by direct read), so a clean boot is itself partial evidence this check passed.
3. **Authentication**: `curl` a protected `voice-orchestrator` route with a deliberately wrong bearer token → expect `401`. Then with the correct `ORCHESTRATOR_SERVICE_TOKEN` → expect a real response (not `401`).
4. **Tenant configured**: at least one tenant/business exists in the target database with business hours, service areas, and emergency rules configured (existing tenant-provisioning flow from Phases 1-7, unchanged).
5. **HCP configured**: the test tenant has valid HCP credentials stored (see [docs/29](29-phase11-12-blocker-resolution.md) Blocker 2, [docs/32](32-hcp-live-verification-checklist.md)).
6. **Notification configured**: the test tenant has at least one notification channel (SMS and/or webhook) configured with a reachable destination.
7. **Telephony configured**: Yash's runtime has the test business's phone number correctly mapped to the test `tenantId`/`businessId` ([docs/30](30-yash-runtime-live-integration-checklist.md)).
8. **Emergency configuration**: the test business has at least one `EmergencyRule` configured (or relies on the documented default keyword fallback) for Test Call #4 below.
9. **Logging enabled**: structured logs are being captured somewhere reviewable (stdout capture, log aggregator, whatever the deployment target provides) for both services, so `callId`/`conversationId` correlation can actually be verified after the fact.

---

## TEST CALL #1 — Normal new caller

**INPUT**: a call from a phone number with no prior `Customer` record in the test tenant, describing a plumbing problem (e.g., "my kitchen faucet is leaking") when asked.

**EXPECTED BEHAVIOR**:

- `POST /conversations` → `201`.
- Turn(s) proceed through qualification (docs/24's conversation state machine: `greeting → identifying → qualifying → confirming → closing`).
- `searchCustomer` is called first, returns `found: false`.
- `createCustomer` is called, succeeds.
- `createLead` is called, succeeds.
- Exactly one consolidated notification is sent to the configured office channel(s).
- `POST /:id/end` → `200`.

**EVIDENCE TO CAPTURE**: full request/response log for every HTTP call (orchestrator ⟷ Yash's runtime, and orchestrator ⟷ core-api if visible), the resulting `Customer`/`Lead`/`Notification` rows in the database, the actual notification content received.

**PASS/FAIL**: _____ (fill in after execution)

---

## TEST CALL #2 — Existing customer

**INPUT**: a call from a phone number that already has a `Customer` record (created in Test Call #1, or seeded directly).

**EXPECTED BEHAVIOR**: `searchCustomer` returns `found: true`; `createCustomer` is never called; `createLead` reuses the existing `customer_id`; no duplicate `Customer` row is created.

**EVIDENCE TO CAPTURE**: same as Test Call #1, plus a database query confirming exactly one `Customer` row exists for that phone number after this call.

**PASS/FAIL**: _____

---

## TEST CALL #3 — Interruption / barge-in

**INPUT**: during the AI's spoken response, the test caller speaks over it before it finishes.

**EXPECTED BEHAVIOR**: TTS audio stops; the interrupted response is recorded (`interrupted: true` if the in-flight-abort path was used, or a `silence`-state transition if the between-turns `POST /:id/interrupt` path was used — docs/24 §2.3's two distinct mechanisms); the new caller utterance is captured as the next turn; no duplicate/overlapping AI response is spoken.

**EVIDENCE TO CAPTURE**: timestamped audio/log trace showing the interruption point, the resulting `TurnResultResponseDto` (note `interrupted` field), and confirmation no stale response continued playing.

**PASS/FAIL**: _____

---

## TEST CALL #4 — Emergency

**INPUT**: the test caller describes a configured emergency condition (e.g., "I have a burst pipe flooding my basement right now").

**EXPECTED BEHAVIOR**: the model calls `escalateEmergency`; the tool result indicates escalation with `action: "forward_call"` (or whatever the configured rule specifies); Yash's runtime executes the actual SIP transfer (see [docs/33](33-emergency-live-verification-runbook.md) — this specific step is the one that requires a live SIP trunk and is tracked separately since it's the highest-risk untested path); a notification fires with urgency correctly reflected.

**EVIDENCE TO CAPTURE**: the `escalateEmergency` tool call/result, the transfer attempt outcome (success/failure — do not mark this PASS unless the transfer genuinely connected to a human or a real destination), the notification content.

**PASS/FAIL**: _____ — **do not mark PASS on detection/notification alone; the transfer itself must be verified per docs/33.**

---

## TEST CALL #5 — Duplicate/retry behavior

**INPUT**: deliberately retry a `POST /conversations` call with the same `callId` after the first succeeded (simulating a runtime-side network ambiguity), and separately retry a `POST /:id/turns` call with the same `idempotencyKey`.

**EXPECTED BEHAVIOR**: the duplicate call-start returns `409`, no second `Call`/`Conversation` row is created; the duplicate turn returns the identical cached `TurnResultResponseDto`, the LLM is not re-invoked a second time, no tool call (e.g. `createLead`) fires twice.

**EVIDENCE TO CAPTURE**: the two response payloads side-by-side (proving identical cached content on the turn replay), a database query confirming exactly one `Call`/`Lead` row exists.

**PASS/FAIL**: _____

---

## After all 5 test calls

Update [docs/29](29-phase11-12-blocker-resolution.md) Blocker 1's status based on actual results — only move it to 🟢 GREEN if Test Calls #1, #2, #3, and #5 all literally passed with captured evidence. Test Call #4's transfer step feeds into [docs/33](33-emergency-live-verification-runbook.md) and Blocker 4 separately, since it has its own live-SIP dependency beyond just "a runtime exists."
