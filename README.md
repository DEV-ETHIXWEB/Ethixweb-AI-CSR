# Ethixweb AI CSR Receptionist Platform

Production-grade AI CSR (Customer Service Representative) phone platform, built to be CRM-agnostic and multi-tenant from day one. First deployment is All Phase Plumbing on Housecall Pro; the platform is intended to become an Ethixweb product serving many home service companies across Housecall Pro, ServiceTitan, Jobber, Service Fusion, FieldEdge, and future FSM platforms.

**Start here: [docs/00-INDEX.md](docs/00-INDEX.md)** for the full architecture blueprint (22 documents — voice pipeline, conversation engine, tool architecture, CRM integration, database schema, security, cost model, deployment, and a full ADR log).

## Why this exists

Housecall Pro's built-in AI CSR has unresolved problems — dropped calls, dead air, robotic conversation, duplicate customers, jobs booked without human review, duplicate/confusing notifications. This platform is a ground-up replacement Ethixweb owns end-to-end, designed so the AI qualifies leads and hands off to a human for scheduling — it never books a job itself, enforced architecturally (no scheduling tool exists in the AI's capability surface), not by prompt instruction.

## Status

Architecture blueprint complete ([docs/00-INDEX.md](docs/00-INDEX.md)). `tenants` and `auth` modules are implemented end-to-end and passing lint/typecheck/build/unit tests. See "What's actually built" below for the precise, current boundary — this section is kept honest rather than aspirational as implementation proceeds module-by-module per [docs/13-implementation-backlog.md](docs/13-implementation-backlog.md).

## What's actually built right now

- **Monorepo scaffold**: pnpm workspaces + Turborepo, strict TypeScript, ESLint flat config enforcing the Hexagonal Architecture layer boundaries (`domain → application → infrastructure → interfaces`) via `eslint-plugin-boundaries` — a real lint failure, not just documentation, if a layer is violated.
- **`packages/database`**: the full Prisma schema translating [docs/06-database-schema.md](docs/06-database-schema.md) into real tables, with `tenant_id` denormalized onto every tenant-scoped table ([docs/20](docs/20-architecture-decision-records.md) ADR-013), a two-role RLS security model (ADR-014), and a narrow `SECURITY DEFINER` escape hatch for API-key authentication (ADR-015) — three migrations, all real conflicts/gaps found and resolved during implementation, not assumed away.
- **`packages/shared-kernel`**: retry/backoff, a per-dependency circuit breaker, an idempotency store (in-memory + Redis-backed), a transactional-outbox relay runner, and a PII-redacting structured logger — 28 unit tests, including a regression test for a real concurrency bug found and fixed during review.
- **`apps/core-api`**: a NestJS/Fastify service with OpenTelemetry bootstrap, health checks, structured logging/tracing/metrics (`shared/observability`), Redis wiring (`shared/redis`), an HMAC webhook-signature utility (`shared/webhooks`, ready for the future CRM/telephony webhook receivers), and two modules built end-to-end:
  - **`tenants`**: tenant/business domain entities, the tenant lifecycle state machine ([docs/15](docs/15-tenant-lifecycle-billing-and-analytics.md) §2, enforced in code), Prisma repositories, use-cases, REST controllers, 17 unit tests, and a real-Postgres integration test proving RLS tenant isolation end-to-end.
  - **`auth`**: email/password login with bcrypt + a timing-safe-by-design credential check, rotating JWT refresh tokens with a Redis-backed revocation list, API-key issuance/revocation (SHA-256-hashed, shown once), a unified `AuthGuard`+`RolesGuard` pair (JWT or API-key, RBAC via `@Roles()`) applied globally so every route is authenticated by default unless marked `@Public()`, and 91 unit tests across domain/application/infrastructure/interfaces layers. The `tenants`/`businesses` controllers were retrofitted to derive `tenantId` from the authenticated principal instead of a client-supplied URL parameter.
- **`infra/terraform`**: networking, ECS Fargate cluster shell, RDS Postgres (Multi-AZ), and ElastiCache Redis modules for the staging environment — written correctly against the AWS provider's schema but **not yet run against a real AWS account** (no credentials or Terraform CLI in the environment this was authored in). See [infra/terraform/README.md](infra/terraform/README.md) for the exact verification status before treating this as deploy-ready.
- **CI**: a GitHub Actions workflow running lint, typecheck, unit tests, build, and Prisma schema validation on every PR.

## What's deliberately not built yet

Every other module in [docs/13-implementation-backlog.md](docs/13-implementation-backlog.md) (`customers`, `calls`, `crm-integration`, `tool-broker`, `leads`, `emergency-rules`, `notifications`, `billing`, `feature-flags`, the voice-orchestrator service) — built one at a time, in dependency order, each with its own full test suite, following the same standard `tenants`/`auth` were held to. Housecall Pro's adapter specifically has 7 open must-verify-before-build items ([docs/05-crm-integration.md](docs/05-crm-integration.md) §2.9) that need a live HCP sandbox account, not guesswork.

**Acknowledged, unresolved gap**: `POST /tenants` (tenant signup) is `@Public()` — there's no platform-admin auth tier yet to gate it with (all RBAC roles are tenant-scoped). It must be network-restricted (VPC-internal/IP-allowlisted), not exposed on the public internet, until that tier exists. Flagged loudly in the controller's own code comment, not silently left open.

## Local development

```bash
cp .env.example .env          # then start Postgres/Redis:
docker compose up -d          # requires Docker — not available in every environment
pnpm install
pnpm --filter @ethixweb/database run generate
pnpm --filter @ethixweb/database run migrate:dev              # applies all three migrations (schema, RLS policies, auth password_hash) — connects as the owner role (MIGRATION_DATABASE_URL)
pnpm --filter @ethixweb/database run db:setup-local-runtime-role  # one-time: sets a local-only password for app_runtime, the role the app actually connects as
pnpm run build
pnpm run lint
pnpm run typecheck
pnpm run test:unit
pnpm --filter @ethixweb/core-api run start:dev
```

**Two database roles, not one** — `MIGRATION_DATABASE_URL` (schema owner, used only by `prisma migrate`) and `DATABASE_URL` (the non-owning `app_runtime` role the running app actually connects as, which Postgres Row-Level Security actually applies to). Pointing both at the same role is a real way to silently disable RLS — found and fixed during a review pass; see [docs/20-architecture-decision-records.md](docs/20-architecture-decision-records.md) ADR-013/ADR-014 and `.env.example` for the full reasoning.

`test:unit` runs everywhere without Docker (fakes/mocks only). `test:integration` (`pnpm --filter @ethixweb/core-api run test:integration`) spins up a real Postgres via testcontainers and requires Docker — not runnable in every environment (this repository's own scaffolding session had none), per [docs/14-backend-stack-and-code-standards.md](docs/14-backend-stack-and-code-standards.md) §6.
