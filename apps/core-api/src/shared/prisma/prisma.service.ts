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
    super({ adapter: new PrismaPg({ connectionString }) });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log("Connected to PostgreSQL");
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
