import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaClient, PrismaPg } from "@ethixweb/database";

/**
 * Thin lifecycle wrapper around the generated Prisma client. Repositories
 * depend on this (or on the `Prisma.TransactionClient` handed to them by
 * {@link TenantContextService}), never on a freshly-constructed
 * `PrismaClient` of their own — one connection pool per process.
 *
 * Prisma 7 requires an explicit driver adapter at the `PrismaClient`
 * constructor rather than reading a connection URL from the schema file
 * (docs comment at the top of packages/database/prisma/schema.prisma) — the
 * adapter is constructed here, directly from `process.env.DATABASE_URL`,
 * because a NestJS provider's `super()` call must happen before any
 * DI-injected dependency (e.g. `ConfigService`) is available on `this`.
 *
 * DATABASE_URL here is deliberately the non-owning `app_runtime` role, never
 * the migration/owner role (MIGRATION_DATABASE_URL, used only by
 * packages/database/prisma.config.ts) — Postgres Row-Level Security always
 * bypasses a table's owner regardless of policy, so this is the actual
 * enforcement point for every RLS policy in the schema, not just a config
 * detail. See docs/20-architecture-decision-records.md ADR-013/ADR-014.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    const connectionString = process.env["DATABASE_URL"];
    if (!connectionString) {
      throw new Error(
        "DATABASE_URL is not set — required to construct the Postgres driver adapter.",
      );
    }
    // `pg.Pool`'s own default (`max: 10`, applied silently whenever this
    // isn't set) is too small for real tool-broker concurrency — found
    // live: a 50-concurrent-request burst against a single tenant's
    // internal/* endpoints (well within the platform's own default
    // 10-concurrent-CALL capacity ceiling once each call makes a handful
    // of tool calls per turn) produced dozens of "Transaction API error:
    // Unable to start a transaction in the given time" 500s — Prisma's
    // interactive-transaction `maxWait` (2s default) is shorter than the
    // queueing delay a pool of 10 produces under that load. Read directly
    // from `process.env` (not the zod-validated `env.schema.ts`, matching
    // `DATABASE_URL` above) for the same reason documented on this
    // service's own class comment: a NestJS provider's `super()` call
    // must happen before any DI-injected ConfigService is available.
    // 30: comfortable headroom over the platform's own default
    // maxTenantConcurrentCalls ceiling (10) even if every call in a single
    // tenant's peak burst fires a tool call in the same instant, still well
    // under Postgres's own default max_connections (100, confirmed against
    // this repo's local Postgres 16) with room for other tenants/dashboard
    // traffic. A real multi-instance production deployment (multiple
    // core-api tasks, each with its own pool this large) will eventually
    // need PgBouncer-style connection pooling at the infra layer or a
    // larger RDS instance class — a real, documented follow-up, not solved
    // by this one number.
    const poolMax = Number(process.env["DATABASE_POOL_MAX"] ?? 30);
    super({
      adapter: new PrismaPg({
        connectionString,
        max: Number.isFinite(poolMax) && poolMax > 0 ? poolMax : 30,
      }),
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log("Connected to PostgreSQL");
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
