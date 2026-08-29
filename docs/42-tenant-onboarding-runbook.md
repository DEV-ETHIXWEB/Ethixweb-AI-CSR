# 42 — Tenant Onboarding Runbook (real, tested API calls)

Concrete, copy-pasteable steps for onboarding one new plumbing/HVAC/electrical
client, using the real HTTP API this backend exposes today — every call
below was actually run against a live local instance while writing this
doc (not guessed from reading the controllers). No source-code change is
required for any step.

Matches docs/15 §1's onboarding flow conceptually; this is the literal,
executable version of it for Phase 1's ops-driven model (Akash runs this
himself — there is no self-service signup UI yet, by design, per docs/15
§1's own "Self-service vs. white-glove" note).

**Status: every step below is REAL and VERIFIED** — the entire flow
(steps 1-13) was run live, end-to-end, in one pass against a fresh tenant
while writing this doc: real tenant → real owner login → real business →
CRM connected+verified → emergency rule → notification channel →
AI-knowledge item created+approved → API key minted → a real customer
created via the tool-broker endpoint with a real `crmCustomerId` returned.
The one genuine exception is the CRM connection step (5), verified only
against a local mock server standing in for Housecall Pro, never a real
HCP account.

## 0. Prerequisites

- `core-api` running and reachable (`GET /healthz` returns 200).
- `MIGRATION_DATABASE_URL` available in your shell (owner-role Postgres
  connection — needed once, for step 2 only).
- A terminal with `curl` and `python3` (used below only to parse JSON
  responses; any JSON-capable tool works).

## 1. Create the tenant

```bash
curl -s -X POST http://localhost:3000/v1/tenants \
  -H "Content-Type: application/json" \
  -d '{"name": "Acme Plumbing Co"}'
# => {"id": "<TENANT_ID>", "name": "Acme Plumbing Co", "planTier": "trial", "status": "trial", ...}
```

`POST /tenants` is deliberately `@Public()` — see
[docs/25](25-service-credential-provisioning.md) and the controller's own
comment: this endpoint **must be network-restricted** (VPC-internal/IP
allowlist) in any real deployment, not exposed on the open internet, until
a platform-admin auth tier exists. Save `<TENANT_ID>`.

## 2. Bootstrap the tenant's first owner user

There is deliberately no HTTP endpoint for this — `POST /v1/auth/users`
requires an existing owner/admin JWT, which cannot exist yet for a brand
new tenant (see `auth.controller.ts`'s own comment on
`registerTeammate`). This one step is a direct database insert, done once
per tenant, with a bcrypt hash matching the app's own scheme (cost 12):

Run from the repo root (or `packages/database`, or `apps/core-api` — anywhere
`bcryptjs` is resolvable as a real dependency):

```bash
node -e "
const bcrypt = require('bcryptjs');
bcrypt.hash('a-real-strong-password-here', 12).then(h => console.log(h));
"
# => $2a$12$... (copy this hash)
```

```sql
INSERT INTO users (id, tenant_id, email, password_hash, role, created_at, updated_at)
VALUES (gen_random_uuid(), '<TENANT_ID>', 'owner@acmeplumbing.com', '<BCRYPT_HASH_FROM_ABOVE>', 'owner', now(), now());
```

(Run via `psql "$MIGRATION_DATABASE_URL"` or any Postgres client using the
owner-role connection string.) This exact pattern is automated for local
dev by `packages/database/scripts/seed-local-pilot-tenant.mjs` — read that
script if you want to script this step for a real environment too; it is
deliberately not run against production data as-is (it also creates a
business/emergency-rule/API-key in one pass, which you may not want to
automate identically for a real client).

## 3. Log in as the new owner

```bash
curl -s -X POST http://localhost:3000/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"tenantId": "<TENANT_ID>", "email": "owner@acmeplumbing.com", "password": "a-real-strong-password-here"}'
# => {"accessToken": "<JWT>", "refreshToken": "...", "user": {...}}
```

`accessToken` expires in 15 minutes by default — re-run this whenever
subsequent steps start returning 401. Every step below uses
`Authorization: Bearer <JWT>`.

## 4. Create the business

```bash
curl -s -X POST http://localhost:3000/v1/businesses \
  -H "Content-Type: application/json" -H "Authorization: Bearer <JWT>" \
  -d '{"name": "Acme Plumbing — Main Office", "timezone": "America/Chicago", "crmType": "housecall_pro"}'
# => {"id": "<BUSINESS_ID>", ...}
```

## 5. Connect the CRM

```bash
curl -s -X POST http://localhost:3000/v1/integrations \
  -H "Content-Type: application/json" -H "Authorization: Bearer <JWT>" \
  -d '{
    "businessId": "<BUSINESS_ID>",
    "crmType": "housecall_pro",
    "credential": {"type": "api_key", "apiKey": "<REAL_HCP_API_KEY>"}
  }'
# => {"id": "<INTEGRATION_ID>", "status": "pending_verification", ...}

curl -s -X POST http://localhost:3000/v1/integrations/<INTEGRATION_ID>/verify \
  -H "Authorization: Bearer <JWT>"
# => {"status": "active", "lastVerifiedAt": "...", ...}  (or 401 if the credential is rejected)
```

**Verified against a local mock HCP server only** (implements the
[Confirmed] endpoints from [docs/05](05-crm-integration.md) §2) — this
step's actual wire compatibility with a real Housecall Pro account is
unverified; see [docs/32](32-hcp-live-verification-checklist.md) before
trusting this against production HCP data.

## 6. Configure business hours (optional but recommended before go-live)

`GET/POST /v1/emergency-rules/business-hours` — see
`emergency-rules.controller.ts` for the exact shape; omitted here for
brevity since it's a straightforward per-day open/close time array.

## 7. Configure emergency rules

Review and edit the seeded defaults for the business's vertical — never
accept unread, per docs/15 §1's own design principle. At minimum, confirm
one rule exists:

```bash
curl -s -X POST http://localhost:3000/v1/emergency-rules \
  -H "Content-Type: application/json" -H "Authorization: Bearer <JWT>" \
  -d '{
    "businessId": "<BUSINESS_ID>",
    "keywordOrPattern": "burst pipe",
    "severity": "critical",
    "escalationAction": "forward_call"
  }'
```

Valid `severity`: `critical|high|medium`. Valid `escalationAction`:
`forward_call|priority_notify|standard_lead`.

## 8. Configure notification channels

```bash
curl -s -X POST http://localhost:3000/v1/notification-channels \
  -H "Content-Type: application/json" -H "Authorization: Bearer <JWT>" \
  -d '{
    "businessId": "<BUSINESS_ID>",
    "channelType": "sms",
    "destination": {"phone": "+15551234567"}
  }'
```

Valid `channelType`: see `NOTIFICATION_CHANNEL_TYPES` in
`notification.entity.ts` (`sms`, `email`, `slack`, `teams`, `webhook`
— confirm current values there, `email`/`slack`/`teams` sender support may
still be a documented gap; check `docs/07` for current channel status).

## 9. Add AI Knowledge (approved, runtime-consumable)

```bash
curl -s -X POST http://localhost:3000/v1/dashboard/knowledge \
  -H "Content-Type: application/json" -H "Authorization: Bearer <JWT>" \
  -d '{
    "businessId": "<BUSINESS_ID>",
    "category": "service-area",
    "title": "Service area",
    "content": "We service the greater Acme metro area within 25 miles of downtown.",
    "aiKnowledge": true
  }'
# => {"id": "<ITEM_ID>", "status": "draft", ...}

curl -s -X POST http://localhost:3000/v1/dashboard/knowledge/<ITEM_ID>/approve \
  -H "Authorization: Bearer <JWT>"
```

Items start in `draft` and are invisible to the AI runtime until
approved — see [docs/38](38-knowledge-and-voice-content.md).
**`aiKnowledge: true` items are the ONLY content the AI runtime ever
reads** (`GET /internal/knowledge/:businessId/ai-knowledge`) — live-verified
this session: a `waitingBrochure`-only item created and approved
alongside an `aiKnowledge`-only item never appeared in the AI-knowledge
response, and vice versa.

## 10. Add Waiting Brochure content (capacity-overflow experience, NOT AI knowledge)

```bash
curl -s -X POST http://localhost:3000/v1/dashboard/knowledge \
  -H "Content-Type: application/json" -H "Authorization: Bearer <JWT>" \
  -d '{
    "businessId": "<BUSINESS_ID>",
    "category": "about",
    "title": "While you wait",
    "content": "Acme Plumbing has served the metro area for 15 years — licensed, bonded, and available 24/7 for emergencies.",
    "waitingBrochure": true
  }'
# then approve the same way as step 9
```

Then enable it on the business's capacity config:

```bash
curl -s -X PATCH http://localhost:3000/v1/dashboard/capacity-config/<BUSINESS_ID> \
  -H "Content-Type: application/json" -H "Authorization: Bearer <JWT>" \
  -d '{"brochureEnabled": true}'
```

Default capacity (`GET /v1/dashboard/capacity-config/<BUSINESS_ID>` with no
config yet set): 10 concurrent calls per tenant, 20% reserved as emergency
headroom, brochure disabled until explicitly turned on. Live-verified this
session at 20 concurrent call-start requests: exactly `floor(10 × 0.8) = 8`
normal calls admitted, the rest correctly rejected with `429` +
`waitingExperience.brochureSegment` populated with real approved brochure
content (never AI-knowledge content) — zero errors, zero duplicate
admissions. A subsequent `isEmergencyPriority: true` call was admitted into
the reserved headroom even while the tenant was at its normal-call ceiling.

## 11. Mint the voice-orchestrator service API key

One key per tenant, used by `voice-orchestrator`'s tool-broker calls into
this API — see [docs/25](25-service-credential-provisioning.md) for the
full mechanism.

```bash
curl -s -X POST http://localhost:3000/v1/api-keys \
  -H "Content-Type: application/json" -H "Authorization: Bearer <JWT>" \
  -d '{"scopes": "full", "expiresAt": null}'
# => {"plaintextKey": "ethx_...", ...} — shown EXACTLY ONCE, copy immediately
```

For a single-tenant `voice-orchestrator` deployment (Phase 1 reality, see
docs/25), this key goes in that service's own `CORE_API_SERVICE_API_KEY`.

## 12. Configure phone number routing (`voice-runtime`)

Single-tenant deployment: set `TENANT_ROUTING_DEFAULT_TENANT_ID`/`_BUSINESS_ID`
in `voice-runtime`'s environment to this tenant/business's ids, restart the
service. Multi-number deployment: use `TENANT_ROUTING_MAP` instead — see
`apps/voice-runtime/.env.example`'s own comment for the exact JSON shape.
Then point the client's Twilio number's Voice webhook at this
`voice-runtime` deployment's public URL — see
[docs/41](41-first-local-real-call.md) step 12 for the exact Twilio
Console configuration.

Also set `EMERGENCY_TRANSFER_NUMBER` (the real on-call number/queue a
`forward_call` emergency escalation transfers to) in this same
environment before restarting — `voice-runtime` refuses to boot at all
without it (or `HUMAN_FALLBACK_NUMBER` as a fallback) whenever
`AI_RECEPTIONIST_ENABLED` is true, which it is by default (env.schema.ts's
own `validate()`; found live, not hypothetical — this var was silently
absent from this repo's own local `.env` for a while before that check
existed). If you also want the kill switch available for this tenant
before go-live, set `HUMAN_FALLBACK_NUMBER` now too — see
[docs/19](19-operational-runbooks.md) §7 for how to actually use it during
an incident.

## 13. Test customer lookup and lead creation

Exercises the same tool-broker-facing endpoints the AI actually calls
mid-conversation — verify before a guided test call, not during it:

```bash
API_KEY="<key from step 11>"

curl -s -X POST http://localhost:3000/v1/internal/customers \
  -H "Content-Type: application/json" -H "X-Api-Key: $API_KEY" \
  -d '{"businessId": "<BUSINESS_ID>", "name": "Test Customer", "phoneE164": "+15559990000"}'
# => real crmCustomerId from the connected CRM, or 404 NoCrmIntegrationConfiguredError if step 5 isn't done
```

## 14. Guided test call

Only after steps 1-13 pass: have the business owner call the real number,
listen to the AI, confirm it sounds right, describe a real service need
through to lead creation, before publishing the number for real customer
traffic — per docs/15 §1's own onboarding flow step. See
[docs/41](41-first-local-real-call.md) for the complete first-real-call
runbook and its pre-call checklist.

## 15. Launch approval

No formal gate exists in code for this — it is an operational decision.
Recommended minimum bar before calling a tenant "live": every check in
[docs/12-production-readiness-checklist.md](12-production-readiness-checklist.md)
relevant to Phase 1 scope, and at minimum one successful guided test call
(step 14) with a real lead landing in the real CRM.
