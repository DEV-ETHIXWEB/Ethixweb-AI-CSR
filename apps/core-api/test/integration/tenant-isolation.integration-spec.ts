import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Client } from "pg";
import { PrismaService } from "../../src/shared/prisma/prisma.service";
import { TenantContextService } from "../../src/shared/prisma/tenant-context.service";

/**
 * Proves, against a real Postgres, the exact thing docs/12-production-readiness-checklist.md
 * requires and docs/20-architecture-decision-records.md ADR-013/ADR-014 were
 * written to fix: that Row-Level Security actually isolates tenants when
 * the app connects as `app_runtime`, not the migration owner. A unit test
 * with a fake repository cannot catch a "connected as the wrong role"
 * regression — RLS is a database-enforced guarantee, so only a real
 * database can verify it.
 *
 * Requires Docker. Run locally with:
 *   pnpm --filter @ethixweb/core-api run test:integration
 * Expected: 3 passing tests. First run pulls the postgres:16-alpine image,
 * so allow ~1-2 minutes for container startup.
 */

const MIGRATIONS_DIR = path.resolve(__dirname, "../../../../packages/database/prisma/migrations");
const RUNTIME_TEST_PASSWORD = "integration_test_app_runtime_only";

describe("Tenant RLS isolation (integration, real Postgres)", () => {
  let container: StartedPostgreSqlContainer;
  let ownerClient: Client;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:16-alpine").start();

    ownerClient = new Client({ connectionString: container.getConnectionUri() });
    await ownerClient.connect();

    // Apply the exact same SQL `prisma migrate deploy` would run, in order.
    const initSql = readFileSync(
      path.join(MIGRATIONS_DIR, "00000000000001_init/migration.sql"),
      "utf-8",
    );
    const rlsSql = readFileSync(
      path.join(MIGRATIONS_DIR, "00000000000002_rls_policies/migration.sql"),
      "utf-8",
    );
    await ownerClient.query(initSql);
    await ownerClient.query(rlsSql);
    await ownerClient.query(`ALTER ROLE app_runtime WITH PASSWORD '${RUNTIME_TEST_PASSWORD}'`);
  }, 120_000);

  afterAll(async () => {
    await ownerClient.end();
    await container.stop();
  });

  function appRuntimeConnectionString(): string {
    const uri = new URL(container.getConnectionUri());
    uri.username = "app_runtime";
    uri.password = RUNTIME_TEST_PASSWORD;
    return uri.toString();
  }

  async function seedTenantWithBusiness(name: string): Promise<string> {
    const tenantId = randomUUID();
    const now = new Date();
    await ownerClient.query(
      `INSERT INTO tenants (id, name, created_at, updated_at) VALUES ($1, $2, $3, $3)`,
      [tenantId, name, now],
    );
    await ownerClient.query(
      `INSERT INTO businesses (id, tenant_id, name, timezone, crm_type, created_at, updated_at)
       VALUES ($1, $2, $3, 'America/Chicago', 'housecall_pro', $4, $4)`,
      [randomUUID(), tenantId, `${name} — Main Office`, now],
    );
    return tenantId;
  }

  it("returns only the scoped tenant's rows, never another tenant's, even though both exist in the same table", async () => {
    const tenantAId = await seedTenantWithBusiness("Tenant A");
    const tenantBId = await seedTenantWithBusiness("Tenant B");

    process.env["DATABASE_URL"] = appRuntimeConnectionString();
    const prisma = new PrismaService();
    await prisma.$connect();
    const tenantContext = new TenantContextService(prisma);

    try {
      const businessesForA = await tenantContext.run(tenantAId, (db) => db.business.findMany({}));
      expect(businessesForA).toHaveLength(1);
      expect(businessesForA[0]?.tenantId).toBe(tenantAId);

      const businessesForB = await tenantContext.run(tenantBId, (db) => db.business.findMany({}));
      expect(businessesForB).toHaveLength(1);
      expect(businessesForB[0]?.tenantId).toBe(tenantBId);
    } finally {
      await prisma.$disconnect();
    }
  });

  it("fails closed (zero rows, not an error, not all rows) when no tenant context is set at all", async () => {
    await seedTenantWithBusiness("Tenant C");

    process.env["DATABASE_URL"] = appRuntimeConnectionString();
    const prisma = new PrismaService();
    await prisma.$connect();

    try {
      // Deliberately bypassing TenantContextService — simulates a repository
      // bug that queries without scoping. RLS must still protect the data.
      const businesses = await prisma.business.findMany({});
      expect(businesses).toHaveLength(0);
    } finally {
      await prisma.$disconnect();
    }
  });

  it("app_runtime cannot run DDL — defense in depth beyond RLS, per ADR-013's two-role model", async () => {
    const runtimeClient = new Client({ connectionString: appRuntimeConnectionString() });
    await runtimeClient.connect();
    try {
      await expect(
        runtimeClient.query("ALTER TABLE businesses ADD COLUMN hacked TEXT"),
      ).rejects.toThrow();
    } finally {
      await runtimeClient.end();
    }
  });
});
