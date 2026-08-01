# 25 — Service Credential Provisioning

Ops runbook fragment, not an essay: the one concrete step needed to mint voice-orchestrator's core-api service credential (`CORE_API_SERVICE_API_KEY`, see `apps/voice-orchestrator/.env.example`). Written because neither [01-architecture-overview.md](01-architecture-overview.md) §9 nor [08-security-observability-reliability.md](08-security-observability-reliability.md) §1.1 documents the actual HTTP call — both describe the API-key mechanism conceptually, not the request/response shape.

## Why voice-orchestrator needs this

`HttpCoreApiClient` (`apps/voice-orchestrator/src/modules/tool-broker/infrastructure/http-core-api-client.ts`) calls core-api's tool-broker-backing endpoints with a single static `X-Api-Key` credential, not a per-tenant lookup — see that file's own comment: this matches [01](01-architecture-overview.md) §9's stated Phase 1 reality (a single-tenant pilot), and per-tenant credential provisioning is real future work once a second tenant actually onboards.

## Minting the key

The key is created via core-api's own `ApiKeysController` (`apps/core-api/src/modules/auth/interfaces/api-keys.controller.ts`) — there is no separate provisioning endpoint or CLI script; this IS the mechanism, used the same way a tenant's own dashboard would use it. It requires an `owner` or `admin` JWT for the tenant voice-orchestrator will act on behalf of (`@Roles("owner", "admin")` — an API key cannot create another API key, see that controller's own comment on why only `@ApiBearerAuth` is documented on it).

```
POST /v1/api-keys
Authorization: Bearer <owner-or-admin JWT access token>
Content-Type: application/json

{
  "scopes": "full",
  "expiresAt": null
}
```

Response (`201`, `CreatedApiKeyResponseDto` — see `apps/core-api/src/modules/auth/interfaces/dto/api-key-response.dto.ts`):

```json
{
  "id": "...",
  "plaintextKey": "ethx_<64 hex chars>",
  "scopes": "full",
  "expiresAt": null,
  "createdAt": "2026-01-01T00:00:00.000Z"
}
```

`plaintextKey` is shown **exactly once** — `CreateApiKeyUseCase` persists only its SHA-256 hash (`apps/core-api/src/modules/auth/domain/value-objects/api-key-secret.vo.ts`); there is no "retrieve it again" path. Copy it into voice-orchestrator's `.env` as `CORE_API_SERVICE_API_KEY` immediately.

Realistic curl example (replace the JWT and host):

```bash
curl -sS -X POST https://core-api.internal.example.com/v1/api-keys \
  -H "Authorization: Bearer <owner-or-admin JWT>" \
  -H "Content-Type: application/json" \
  -d '{"scopes": "full", "expiresAt": null}'
```

## Scope value: `full`, not a free string or comma-separated list

`CreateApiKeyDto` (`apps/core-api/src/modules/auth/interfaces/dto/create-api-key.dto.ts`) restricts `scopes` to a fixed enum, `API_KEY_SCOPES = ["full", "read_only"] as const` — checked via `@IsIn(API_KEY_SCOPES)`. It is **not** a free-form string and **not** comma-separated, despite `ApiKeyRepository`/`ApiKey` entity typing the persisted column as a plain `string` (the enum constraint lives at the DTO/validation boundary, not the domain type).

`voice-orchestrator` needs `full`: its tool-broker calls span multiple read/write operations across customers, leads, and notifications (search, create, update) — `read_only` would reject the write calls a live conversation needs to make (creating customers/leads, claiming leads via the SMS flow). **Note**: as of this writing, `AuthenticateApiKeyUseCase` (`apps/core-api/src/modules/auth/application/queries/authenticate-api-key.use-case.ts`) attaches `scopes` to the resulting `ApiKeyPrincipal` but nothing in the request pipeline actually checks/enforces it yet — no scope-checking guard exists alongside `AuthGuard`/`RolesGuard`. Documenting `full` here is choosing the semantically correct value for when enforcement lands, not compensating for a gap that currently blocks anything.

## Rotation / revocation

`DELETE /v1/api-keys/:id` (same controller, same JWT auth) revokes a key immediately — use this before generating a replacement if rotating, and update `CORE_API_SERVICE_API_KEY` in voice-orchestrator's deployed environment (Secrets Manager per [08](08-security-observability-reliability.md) §1.2, not `.env` in any real environment) in the same change. See [19-operational-runbooks.md](19-operational-runbooks.md) §6 for the "credential compromise" runbook if this is a rotation forced by suspected leakage rather than routine.
