import { defineConfig, env } from "prisma/config";

/**
 * Prisma 7 moved CLI/Migrate connection config out of schema.prisma and into
 * this file (see the comment at the top of prisma/schema.prisma). This is
 * used by `prisma migrate`/`prisma db`/`prisma studio` — the actual runtime
 * PrismaClient in apps/core-api still connects via an explicit driver
 * adapter (apps/core-api/src/shared/prisma/prisma.service.ts), which is
 * PrismaClient's own separate, required piece of Prisma 7 configuration.
 *
 * Deliberately MIGRATION_DATABASE_URL, not DATABASE_URL: this is the
 * two-role model from docs/20-architecture-decision-records.md ADR-013/
 * ADR-014 — migrations run as the table-owning role (can CREATE/ALTER
 * TABLE, bypasses RLS as owner, which is exactly why it must never be the
 * role the running application connects as). DATABASE_URL is reserved for
 * the app's own `app_runtime` connection, which cannot run DDL and IS
 * subject to RLS. Pointing this file at DATABASE_URL would mean Migrate
 * silently succeeds locally but fails in any environment where the two
 * roles' privileges are actually distinct — found and fixed during a
 * review pass specifically because that mismatch would otherwise only
 * surface once, in whichever environment first enforced it for real.
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: env("MIGRATION_DATABASE_URL"),
  },
  migrations: {
    path: "prisma/migrations",
  },
});
