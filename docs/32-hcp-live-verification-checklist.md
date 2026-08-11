# 32 — HCP Live Verification Checklist

Ten scenarios to run against a **real** Housecall Pro sandbox/test account (see [docs/29](29-phase11-12-blocker-resolution.md) Blocker 2 for how to obtain credentials). Nothing in this document has been executed — it is the checklist for when real HCP credentials exist. Do not put real credentials, API keys, or account identifiers into this file or any committed document; reference them only via environment variables / the existing encrypted-credential storage.

For each test: request, expected response, expected database state, expected HCP-side state, duplicate behavior, and the evidence required to mark it verified.

---

## 1. Existing customer lookup

**Request**: `searchCustomer` tool call with a phone number known to already exist in the connected HCP account.
**Expected response**: `found: true`, HCP customer ID and details returned.
**Database state**: no new `Customer` row created (existing one reused/synced).
**HCP state**: unchanged — read-only operation.
**Duplicate behavior**: repeated calls return the same result, no side effects.
**Evidence required**: the real HCP API request/response (redact credentials), the resulting `Customer` row.

## 2. New customer creation

**Request**: `createCustomer` for a phone number with no HCP match.
**Expected response**: success, new HCP customer ID returned.
**Database state**: new `Customer` row created with the HCP-assigned ID stored.
**HCP state**: new customer record exists in HCP.
**Duplicate behavior**: see #3.
**Evidence required**: HCP API request/response, resulting `Customer` row, confirmation the HCP-side record exists (via HCP's own UI or a follow-up `searchCustomer`).

## 3. Customer deduplication

**Request**: `createCustomer` called twice for the same phone number (simulating a retry).
**Expected response**: the second call either fails with a clear duplicate error, or (if `createCustomer` is itself idempotency-key-protected via the Tool Broker's stage-3 idempotency, per docs/04 §2) returns the identical result without creating a second HCP record.
**Database state**: exactly one `Customer` row.
**HCP state**: exactly one customer record in HCP for that phone number.
**Duplicate behavior**: this IS the test.
**Evidence required**: both call results side-by-side, a database query confirming one row, an HCP-side query confirming one record.

## 4. Lead creation

**Request**: `createLead` for an existing/newly-created customer.
**Expected response**: success, `Lead` row created with `callId` correctly referencing the `Call` row (per the FK-ordering guarantee, Phase 10).
**Database state**: new `Lead` row.
**HCP state**: depends on whether lead-sync-to-HCP is part of the current CRM adapter scope — confirm against the actual adapter code (`apps/core-api/src/modules/crm-integration` or equivalent) before assuming HCP receives a job/lead record automatically; do not assume behavior not confirmed in code.
**Duplicate behavior**: see #5.
**Evidence required**: the `Lead` row, any corresponding HCP-side record if the adapter creates one.

## 5. Lead retry

**Request**: retry the same `createLead` tool call (same `call_id`, simulating a runtime retry after an ambiguous response).
**Expected response**: idempotent — the `Lead.callId` unique constraint prevents a second row; the retry should surface the existing lead, not create a duplicate or error unclearly.
**Database state**: exactly one `Lead` row for that `callId`.
**Evidence required**: both call results, a database query confirming one row.

## 6. HCP timeout

**Request**: any HCP-backed tool call while HCP is artificially slow or unreachable (simulate via a firewall rule, a wrong URL, or a sandbox outage window if HCP provides one — do not attempt to actually DoS Housecall Pro's production service).
**Expected response**: the tool call fails within its configured `timeoutMs` budget ([tool-catalog.ts](../apps/voice-orchestrator/src/modules/tool-broker/domain/tool-catalog.ts) — `searchCustomer` 2000ms, `createCustomer` 3000ms, `createLead` 3000ms), the turn does not hang indefinitely, the conversation continues or degrades gracefully rather than crashing the call.
**Evidence required**: timestamped logs showing the timeout firing at approximately the configured budget, the turn's actual HTTP response.

## 7. HCP 4xx

**Request**: a tool call with input HCP will reject (e.g., a malformed address if HCP validates that server-side).
**Expected response**: the error is mapped to a clear internal error, not a raw pass-through 500; the AI/turn handles it gracefully (does not crash, potentially asks the caller to repeat/clarify information).
**Evidence required**: the actual HCP 4xx response, the resulting tool-result error surfaced to the model.

## 8. HCP 5xx

**Request**: a tool call during an HCP-side error (if the sandbox allows triggering one, or via a controlled fault injection at the adapter boundary).
**Expected response**: retried per the tool's configured `retryPolicy` (`createCustomer` maxAttempts 4, `createLead` maxAttempts 5 — per tool-catalog.ts), then fails gracefully if retries are exhausted.
**Evidence required**: logs showing retry attempts, final outcome.

## 9. Duplicate request

**Request**: two genuinely concurrent identical tool calls (not a sequential retry — an actual race).
**Expected response**: the Tool Broker's stage-3 idempotency (docs/04 §2) prevents double execution; both requests resolve to the same result.
**Evidence required**: both response payloads, database/HCP state confirming no duplicate record.

## 10. Full call → customer → lead flow

**Request**: a complete simulated call using real HCP credentials end-to-end (this is effectively [docs/31](31-first-real-phone-call-runbook.md) Test Call #1, but specifically verifying the HCP leg rather than the whole pipeline).
**Expected response**: customer search → (create if needed) → lead create, all against real HCP, matching the behavior already proven against the fake client in the simulator.
**Evidence required**: the complete request/response chain, final database state, final HCP-side state.

---

## After running all 10

Update [docs/29](29-phase11-12-blocker-resolution.md) Blocker 2's status — only mark 🟢 GREEN if all 10 scenarios above have captured, literal evidence. Partial completion (e.g., 1-5 passing, 6-9 not yet attempted) should be recorded as 🟡 YELLOW with the specific gap noted, not rounded up.
