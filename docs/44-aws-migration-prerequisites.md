# AWS migration prerequisites (captured from Fly.io, 2026-10-10)

Everything the CSR needed on Fly.io, written down before the Fly.io setup was
removed, so the AWS move can rebuild it. **No AWS work has started.** It begins
only when Akash approves it.

Secret values are not recorded here. Fly.io cannot read a secret back once it
is set, so every value has to come from the provider's own console or from the
local `.env` files.

## 1. Services

All four are Node apps in this monorepo with their own Dockerfile
(`apps/<name>/Dockerfile`, built from the repo root). Fly region was `sjc`.

| Service            | Port | Health check   | Fly size             | Always on       | Notes                                                                                                                             |
| ------------------ | ---- | -------------- | -------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| core-api           | 3000 | `GET /healthz` | shared-cpu-1x, 1 GB  | yes, 1 machine  | Only service that talks to Postgres                                                                                               |
| voice-orchestrator | 3100 | `GET /healthz` | shared-cpu-1x, 1 GB  | yes, min 1      | Calls Anthropic, keeps conversations in Redis                                                                                     |
| voice-runtime      | 3200 | `GET /healthz` | performance-1x, 2 GB | yes, 2 machines | Twilio media WebSocket. Needs dedicated CPU (shared CPU made audio stutter) and long-lived WebSocket support on the load balancer |
| dashboard          | 3001 | none           | shared-cpu-1x, 1 GB  | min 1           | Next.js, `HOSTNAME=0.0.0.0`                                                                                                       |

Non-secret env set in `fly.toml`: `NODE_ENV=production` and `PORT` as above for
all four; `SHUTDOWN_DRAIN_TIMEOUT_MS=30000` on voice-runtime, with a 35 s kill
timeout so live calls can drain on deploy. Every service needs TLS (Fly forced
HTTPS).

## 2. Environment variables (names only)

| Service            | Variables                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| core-api           | `DATABASE_URL`, `MIGRATION_DATABASE_URL`, `REDIS_URL`, `CORE_API_SERVICE_API_KEY`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `INTEGRATION_CREDENTIALS_MASTER_KEY`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`                                                                                                                                                |
| voice-orchestrator | `ANTHROPIC_API_KEY`, `CORE_API_BASE_URL`, `CORE_API_SERVICE_API_KEY`, `ORCHESTRATOR_SERVICE_TOKEN`, `REDIS_URL`, `AI_PROVIDER_FALLBACK_ORDER`, `DEFAULT_LLM_MODEL`                                                                                                                                                                                                                 |
| voice-runtime      | `DEEPGRAM_API_KEY`, `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, `ELEVENLABS_MODEL_ID`, `EMERGENCY_TRANSFER_NUMBER`, `ORCHESTRATOR_SERVICE_TOKEN`, `PUBLIC_BASE_URL`, `VOICE_ORCHESTRATOR_BASE_URL`, `TENANT_ROUTING_DEFAULT_BUSINESS_ID`, `TENANT_ROUTING_DEFAULT_TENANT_ID`, `TENANT_ROUTING_DEFAULT_TIMEZONE`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` |
| dashboard          | `CORE_API_BASE_URL`                                                                                                                                                                                                                                                                                                                                                                |

Pairs that must match: `CORE_API_SERVICE_API_KEY` (core-api and
orchestrator) and `ORCHESTRATOR_SERVICE_TOKEN` (orchestrator and runtime).

Not in the local `.env` files, so they have to be recreated:

- `CORE_API_SERVICE_API_KEY` for core-api: generate a new one and set it on both services.
- `ELEVENLABS_MODEL_ID`: optional, a model name rather than a secret; check the ElevenLabs console.
- The production `JWT_*` secrets: new ones only mean dashboard users sign in again.
- `INTEGRATION_CREDENTIALS_MASTER_KEY`: the backup has 0 rows in `integrations`, so a new key loses nothing.

`*_BASE_URL`, `PUBLIC_BASE_URL`, `DATABASE_URL`, `MIGRATION_DATABASE_URL` and
`REDIS_URL` all change to the new AWS endpoints.

## 3. Data

- **Postgres** (Fly Managed Postgres `ethixweb-db`, PG 16.15, database
  `fly-db`, roles `app_runtime` writer and `fly-user` schema admin). The full
  backup is kept **outside the repo** because it holds customer data:
  `/Users/akash_ethixweb/AKASH_ETHIXWEB/CSR/fly-backup-2026-10-10/`
  (`ethixweb-db.dump` custom format, `ethixweb-db.sql` plain SQL, `SHA256SUMS`).
  It was verified by restoring it into a local database: 204 calls, 1,697
  transcript lines, 63 leads, 63 notifications, 6 customers, 20 knowledge
  items, 1 tenant, 1 business, 1 user, 11 migrations. The newest call is
  2026-10-08 23:46 IST, the last real activity.
- Restore on AWS (RDS Postgres 16): `pg_restore --no-owner --no-privileges -d <db> ethixweb-db.dump`.
  The only restore errors are the Fly monitoring extensions `pgaudit` and
  `pg_stat_monitor`, which are safe to ignore. Re-apply the role and RLS
  setup from `packages/database/scripts/fly-rls-policies.sql`, adjusted for
  the RDS role names.
- **Redis** (Upstash `ethixweb-redis`): only live call state, idempotency keys
  and capacity slots, with TTLs of at most a few hours. Nothing to migrate;
  start empty.

## 4. External services to repoint

- **Twilio**: the phone number's voice webhook and media stream URL point at
  the voice-runtime public URL (`PUBLIC_BASE_URL`). Update them to the AWS URL
  when voice-runtime is live there.
- Anthropic, Deepgram, ElevenLabs: API keys only, no callback URLs.
- Dashboard: talks to core-api through `CORE_API_BASE_URL`.
