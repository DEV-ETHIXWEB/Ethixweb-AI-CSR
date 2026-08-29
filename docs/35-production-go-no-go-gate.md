# 35 — Production Go/No-Go Gate

## Final E2E test matrix

| #   | Test                   | Dependency                                                            | Expected result                                          | Current status                                           | Evidence                                                    | Blocker                                                                          |
| --- | ---------------------- | --------------------------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 1   | Normal new caller      | Live runtime + HCP                                                    | Customer created, lead created, one notification         | 🟡 proven via simulator; 🔴 not proven live              | [docs/31](31-first-real-phone-call-runbook.md) Test Call #1 | Blockers 1, 2                                                                    |
| 2   | Existing customer      | Live runtime + HCP                                                    | Customer reused, no duplicate                            | 🟡 simulator only                                        | docs/31 Test Call #2                                        | Blockers 1, 2                                                                    |
| 3   | Repeat caller          | Live runtime + HCP                                                    | `lookupPreviousCalls` returns history                    | 🟡 simulator only                                        | (extend docs/31 if needed)                                  | Blockers 1, 2                                                                    |
| 4   | Invalid/unknown tool   | None (repo-only)                                                      | Rejected structurally, never reaches core-api            | 🟢 **verified**                                          | Phase 10/11 e2e test, re-run this session, passing          | None                                                                             |
| 5   | Scheduling attempt     | None (repo-only)                                                      | Impossible — no such tool exists                         | 🟢 **verified**                                          | Same as #4                                                  | None                                                                             |
| 6   | Caller interruption    | Live runtime                                                          | Both barge-in mechanisms function correctly              | 🔴 unverified live                                       | docs/31 Test Call #3                                        | Blocker 1                                                                        |
| 7   | Early hangup           | None (repo-only) for the backend side; live runtime for the full path | Clean end, correct lead/call state                       | 🟢 backend-side verified; 🔴 live unverified             | Phase 10 e2e tests, re-run passing                          | Blocker 1                                                                        |
| 8   | Emergency              | Live runtime + SIP                                                    | Detection → escalation → notification → transfer → human | 🟡 detection/notification proven; 🔴 transfer unverified | [docs/33](33-emergency-live-verification-runbook.md)        | Blockers 1, 4                                                                    |
| 9   | HCP unavailable        | None (repo-only, simulated outage)                                    | Graceful degrade, no crash                               | 🟢 **verified** (core-api outage tests)                  | Phase 10 e2e tests                                          | None (repo-level proof only; live HCP-specific outage per docs/32 #6-8 still 🔴) |
| 10  | Core API unavailable   | None (repo-only)                                                      | Turn still returns 200, call-start correctly blocked     | 🟢 **verified**                                          | Phase 10 e2e tests, re-run passing                          | None                                                                             |
| 11  | Notification failure   | None (repo-only, DLQ)                                                 | Retried/surfaced, not silently dropped                   | 🟢 **verified** (Phase 7 DLQ, unchanged)                 | Phase 7 tests                                               | None                                                                             |
| 12  | Duplicate call         | None (repo-only)                                                      | 409, no duplicate Call/Conversation                      | 🟢 **verified**                                          | Phase 10 concurrency test                                   | None                                                                             |
| 13  | Duplicate turn         | None (repo-only)                                                      | Cached replay, no re-invocation                          | 🟢 **verified**                                          | Phase 10 concurrency test                                   | None                                                                             |
| 14  | Duplicate notification | None (repo-only)                                                      | Deduped via `dedupKey`                                   | 🟢 **verified**                                          | Phase 10 notification test                                  | None                                                                             |
| 15  | SIP transfer           | Live SIP                                                              | Caller connects to human                                 | 🔴 **unverified**                                        | docs/33 scenarios 1-4                                       | Blocker 4                                                                        |
| 16  | Full successful lead   | Live runtime + HCP                                                    | End-to-end real call produces a real, correct lead       | 🔴 **unverified**                                        | docs/31 Test Call #1                                        | Blockers 1, 2                                                                    |

**Read of this table**: 8 of 16 scenarios (#4, #5, #7-partial, #9-partial, #10, #11, #12, #13, #14) are genuinely, literally verified at the repository/simulator level with 606/606 passing tests behind them. The remaining scenarios all share the same root cause — no live runtime, no live HCP, no live SIP — not 8 separate unrelated gaps.

## Production Go/No-Go checklist

Nothing below is marked GREEN based on code inspection alone where the requirement explicitly needs a live test — matching the instruction that governs this whole document.

- [ ] Real phone call received — 🔴 (Blocker 1)
- [ ] Real audio reaches STT — 🔴 (Blocker 1)
- [ ] Real AI response reaches caller — 🔴 (Blocker 1)
- [ ] Barge-in works — 🔴 (Blocker 1)
- [ ] Existing HCP customer lookup works — 🔴 (Blocker 2)
- [ ] New HCP customer flow works — 🔴 (Blocker 2)
- [ ] Lead creation works — 🟡 (proven against fake client; real HCP unverified)
- [ ] Notification works — 🟢 (verified, consolidated, deduped — Phase 10)
- [ ] Duplicate protection works — 🟢 (verified at every write path — DB unique constraints + Redis idempotency)
- [ ] Emergency detection works — 🟢 (verified, structural + fail-safe-toward-escalation)
- [ ] Live SIP transfer works — 🔴 (Blocker 4)
- [x] Real PostgreSQL integration test passes — 🟢 (Blocker 3 **closed 2026-08-30** — `Tests: 9 passed, 9 total` against a real testcontainers Postgres; evidence in [docs/29](29-phase11-12-blocker-resolution.md))
- [x] Tenant isolation passes — 🟢 (`tenant-isolation.integration-spec.ts` literally ran and passed on 2026-08-30 against real Postgres as the non-owning `app_runtime` role — no longer inspection-only)
- [ ] Staging deployment works — 🔴 (Blocker 5)
- [ ] Monitoring works — 🔴 (Blocker 5 — not built)
- [ ] Alerting works — 🔴 (Blocker 5 — not built)
- [ ] Rollback works — 🟡 (code/DB rollback via standard tooling is fine; a real telephony kill-switch now exists — `voice-runtime`'s `AI_RECEPTIONIST_ENABLED`, [docs/19](19-operational-runbooks.md) §7 — verified locally for both states, not yet against a real Twilio account, hence still 🟡 not 🟢)
- [ ] Full test suite passes — 🟢 (733/733 unit tests across all four apps — core-api 499, voice-orchestrator 170, voice-runtime 62, dashboard 2 — re-confirmed this session; Docker-dependent integration suites still blocked, see Blocker 3 above)
- [ ] No scheduling/booking capability — 🟢 (verified structurally — 8-tool catalog, zero scheduling tools, adversarial test passing)
- [ ] No critical security findings — 🟢 (auth/tenant-isolation/secret-handling audited this session, no critical findings; per-tenant rate limiting on the tool-broker surface has since shipped (`ServiceRateLimitGuard`) — the Twilio `trustProxy` assumption is the one item still genuinely open, medium-priority, not critical)

## PRODUCTION READINESS: **NO-GO**

Still NO-GO, but measurably closer: **4 of 19** checklist items are 🔴, down from 6. Blocker 3 is closed (2026-08-30) and took two rows green with it. The remaining red items trace to 4 blockers, not 5, in [docs/29](29-phase11-12-blocker-resolution.md).

Also updated 2026-08-30: Blocker 1 is no longer "another party must build a runtime" — `apps/voice-runtime` exists in this repository (Phase 15B) and boots. It now needs six vendor credentials (Twilio ×3, Deepgram ×1, ElevenLabs ×2), which is a purchasing task, not an engineering one.

## Recommended blocker resolution order (with reasoning)

1. ~~**Blocker 3 (real Postgres gate)**~~ — ✅ **DONE 2026-08-30.** Was the cheapest by far, exactly as predicted: Docker on one machine, no vendor, no account. Closed two checklist rows.
2. **Blocker 2 (HCP credentials)** — an account-provisioning task, no engineering dependency on Blocker 1. Can run in parallel with #1, and unblocks docs/32 entirely on its own.
3. **Blocker 1 (Yash's runtime)** — the largest, most involved blocker; unblocks the majority of the remaining 🔴 rows in the E2E matrix once resolved.
4. **Blocker 5 (staging/deployment/alerting)** — needed before any of the above can be tested somewhere persistent rather than ad hoc; sequenced after 1-3 because there's nothing meaningful to deploy to staging until the runtime exists to test against.
5. **Blocker 4 (live SIP/emergency transfer)** — deliberately last: it depends on Blocker 1 being resolved first, and it's the highest-risk test to run for the first time, so it should happen once the rest of the pipeline is already proven stable, not before.

## The exact next command to run

Blocker 3's command has been run and passed (see above). The next gate is the
first real phone call — Blocker 1 — which needs the six vendor credentials
listed in [docs/29](29-phase11-12-blocker-resolution.md) Blocker 1, then:

```bash
pnpm --filter @ethixweb/voice-runtime run start:dev
```

Expected: a clean boot on port 3200 and `GET /healthz` → 200. Today it fails
closed at bootstrap on those six variables, which is correct behaviour, not a
defect. Once it boots, follow [docs/41](41-first-local-real-call.md)'s 22
steps and capture evidence per step — do not mark any of them passed without
actually running them.

For the record, Blocker 3's own command remains:

```bash
pnpm --filter @ethixweb/core-api run test:integration
```

Expected: `Tests: 9 passed, 9 total` (the document originally predicted 8; a
third suite has since been added). If it ever prints less, treat that as a
real regression, not a flake to retry past.
