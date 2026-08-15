# Phase 15 Audit: CRM Integration (HCP End-to-End Path)

**Date:** 2026-08-15
**Scope:** Verify whether the AI-qualification → CRM-handoff path described in
docs/04-ai-tool-architecture.md and docs/05-crm-integration.md is real,
wired code, versus documentation describing a plan. Traced from the
tool-broker HTTP surface down to the live Housecall Pro HTTP calls.

## Headline finding

**The path is real and complete, not a stub.** A `createLead` or
`searchCustomer` tool call from the voice orchestrator reaches an actual
`fetch()` against Housecall Pro's API, through a chain with no missing links:

```
Voice orchestrator (external process, API-key auth)
  → LeadsToolController / CustomersToolController   (internal/leads, internal/customers)
  → CreateLeadUseCase / ResolveCustomerUseCase       (apps/core-api/.../application)
  → CrmLeadSyncPort / CrmCustomerSyncPort            (domain ports)
  → CrmAdapterRegistryImpl.resolve()                 (per-tenant circuit breaker wrap)
  → ResilientCrmAdapter                              (retry + circuit breaker)
  → HousecallProAdapter                              (real fetch() to HCP's Public API)
```

This was implemented far enough ahead of what "Phase 15" implied going into
this audit that the main risk isn't "is it built" — it's "which parts are
confirmed against real HCP behavior versus reasonable guesses," which the
code itself already tracks and flags.

## What's genuinely built

- **Tool-broker HTTP surface** — `leads-tool.controller.ts` and
  `customers-tool.controller.ts` are separate, role-unrestricted,
  API-key-only controllers, deliberately split from the JWT-only
  dispatcher-facing controllers (`leads.controller.ts`,
  `customers.controller.ts`). The separation is explained in-code as a
  direct consequence of the voice orchestrator having become a separate
  service rather than an in-process consumer — auth model changed
  accordingly ("inject" became "call over HTTP").
- **Use-case wiring** — `CreateLeadUseCase` and `ResolveCustomerUseCase` both
  inject their CRM sync ports and actually call
  `resolveActiveIntegrationId` → `createLead`/`searchCustomer` against them;
  this isn't dead code sitting next to a Postgres-only path.
- **Resilience layer** (`resilient-crm-adapter.ts`) — every network-calling
  adapter method is wrapped in retry + circuit breaker uniformly, once, at
  the registry level, rather than per-adapter. Auth failures
  (`CrmAuthenticationError`) are correctly excluded from retry — a bad
  credential fails the same way every time, so retrying just burns the
  CRM's rate limit.
- **Per-tenant circuit isolation** (`crm-adapter-registry.ts:45`) — breakers
  are keyed `crm:{crmType}:{tenantId}`, not `crm:{crmType}`, specifically so
  one tenant's bad credential can't trip the circuit for every other tenant
  on the same CRM vendor.
- **Credential encryption** — `aes-gcm-credential-encryptor.ts` backs the
  `CredentialEncryptorPort`; credentials are not stored plaintext.
- **Webhook signature verification** — HMAC-based, with a documented
  fallback across two candidate header names (see Risks below).

## The HCP adapter specifically (`housecall-pro.adapter.ts`, 234 lines)

This is the one fully real adapter, and its own header comment sets the
standard the rest of the audit judges it against: every method is tagged
**[Confirmed]** (verified against HCP's own docs/Help Center) or
**[Unverified]** (a reconstructed, uncorroborated guess) — carried from the
research doc (docs/05 §2) into the code itself, so a guess never silently
reads as settled fact once implemented.

**[Confirmed]:**

- `POST /leads` is HCP's genuine, separate Lead resource — never "Create a
  Job" (line 99).
- Auth is a static Admin-issued API key via `Authorization: Bearer` (line 189) — OAuth2/Partner Jobs API path is explicitly _not_ supported because
  it's unconfirmed.

**[Unverified], and handled honestly rather than papered over:**

- Whether `GET /customers` supports server-side phone filtering — the
  adapter falls back to paging through up to 1,000 customers
  (`MAX_PAGES_SCANNED = 20 × PAGE_SIZE = 50`) and matching client-side
  (line 56).
- Exact create-customer/create-lead field names — best-effort, documented
  as a hypothesis, not fact (lines 84, 101).
- Webhook signature header name — two candidates tried in order, first
  match wins (line 25).
- Webhook payload envelope shape — best-effort parse with a content-hash
  fallback for `eventId` when no explicit id is present (line 157).

**Deliberately not implemented, and fails loud rather than guessing:**

- `updateLead` — no confirmed HCP endpoint exists for updating a Lead; the
  method throws `CrmAdapterError` with a citation back to the doc's
  must-verify list rather than calling something that might not exist
  (line 114).
- `attachNote` — same treatment; the adapter routes qualification context
  through `createLead`'s own notes field instead of guessing at a
  notes/attachment endpoint.

This is the right failure mode for unverified integrations: throw with a
specific, actionable error rather than silently no-op or fabricate a
response. The four other CRM adapters (`ServiceTitanAdapter`,
`JobberAdapter`, `ServiceFusionAdapter`, `FieldEdgeAdapter`) apply the exact
same discipline via a shared `StubCrmAdapter` base class — every method
throws `CrmAdapterNotImplementedError` uniformly, so a caller can never
mistake "not built yet" for "built, and it did nothing."

## Scope clarification

Only **Housecall Pro** has a real implementation. The other four CRM types
registered in `CrmAdapterRegistryImpl` (ServiceTitan, Jobber, Service
Fusion, FieldEdge) are 8-line stub files extending `StubCrmAdapterBase` —
interface-conformant, wired into the same registry/circuit-breaker path,
but every method throws `CrmAdapterNotImplementedError` on call. This
matches docs/13-implementation-backlog.md's stated intent ("proves the
interface is genuinely CRM-agnostic before a second real implementation is
built") — it is not an oversight, but it does mean any tenant configured
for a CRM other than HCP will get a hard failure on every sync attempt,
not degraded functionality.

## Risks / follow-ups before production trust

1. **Every [Unverified] item above must be confirmed against a live HCP
   sandbox** before this adapter is trusted with real tenant data — this is
   already tracked as docs/05 §2.9 item 5 / docs/13 crm-integration task 0,
   not a new finding, but worth restating as the literal gate on
   production readiness.
2. **Client-side phone search caps at 1,000 customers scanned**
   (`MAX_PAGES_SCANNED = 20`). Fine for a typical single-business customer
   list per the adapter's own note; will silently return "no match" past
   that ceiling for a large existing customer base. Worth a log/metric if
   `MAX_PAGES_SCANNED` is ever hit, so a false "not found" doesn't go
   unnoticed.
3. **Webhook header/envelope ambiguity** — the two-candidate-header
   fallback and content-hash `eventId` fallback are reasonable engineering
   under uncertainty, but both should collapse to one confirmed path once
   verified, both to simplify the code and to remove the (small) risk of
   the wrong header winning silently.
4. **Non-HCP tenants get a hard failure, not a warning** — if any tenant
   is currently configured (or could be self-configured via the
   integrations UI) for ServiceTitan/Jobber/etc., confirm the dashboard
   surfaces `CrmAdapterNotImplementedError` clearly rather than a generic
   500, so it reads as "not built yet" to an operator, not "broken."

## Bottom line

Phase 15 is not "documentation ahead of code" — the HCP path is real,
tested, resilient, and unusually well-annotated about its own
uncertainty. The gate to production is verification against a live HCP
sandbox for the items already flagged `[Unverified]` in the adapter itself,
not further implementation work.
