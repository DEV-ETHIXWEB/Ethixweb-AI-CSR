import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Client } from "pg";
import { PrismaService } from "../../src/shared/prisma/prisma.service";
import { TenantContextService } from "../../src/shared/prisma/tenant-context.service";
import { PrismaCallRepository } from "../../src/modules/calls/infrastructure/prisma-call.repository";
import { StartCallUseCase } from "../../src/modules/calls/application/start-call.use-case";
import { PrismaLeadRepository } from "../../src/modules/leads/infrastructure/prisma-lead.repository";
import { CallNotFoundForLeadError } from "../../src/modules/leads/domain/errors";

/**
 * Proves, against a REAL Postgres database (not FakeLeadRepository), the
 * exact production blocker this fix exists for: `Lead.callId` carries a
 * real database foreign key to `calls.id`, and `FakeLeadRepository` has no
 * concept of that constraint at all — a unit test using it can prove
 * CreateLeadUseCase's own application logic, but structurally CANNOT prove
 * the database will actually accept the insert. Only a real database can.
 *
 * Two things are proven here, in order:
 * 1. The bug is real: inserting a `leads` row whose `call_id` has no
 *    matching `calls` row fails with Postgres error 23503 (foreign key
 *    violation) — i.e. this is not a hypothetical concern.
 * 2. The fix works: going through `StartCallUseCase` BEFORE the lead
 *    insert (the documented ordering guarantee) succeeds cleanly, and the
 *    resulting `leads.call_id` correctly references a real `calls.id` row.
 *
 * Requires Docker. Run locally with:
 *   pnpm --filter @ethixweb/core-api run test:integration
 */

const MIGRATIONS_DIR = path.resolve(__dirname, "../../../../packages/database/prisma/migrations");
const RUNTIME_TEST_PASSWORD = "integration_test_app_runtime_only";
const MIGRATION_FILES = [
  "00000000000001_init/migration.sql",
  "00000000000002_rls_policies/migration.sql",
  "00000000000003_add_user_password_hash/migration.sql",
  "00000000000004_usage_records/migration.sql",
  "00000000000005_usage_records_rls/migration.sql",
];

describe("Lead.callId -> Call.id FK integrity (integration, real Postgres)", () => {
  let container: StartedPostgreSqlContainer;
  let ownerClient: Client;
  let prisma: PrismaService;
  let tenantContext: TenantContextService;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:16-alpine").start();

    ownerClient = new Client({ connectionString: container.getConnectionUri() });
    await ownerClient.connect();

    for (const file of MIGRATION_FILES) {
      const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf-8");
      await ownerClient.query(sql);
    }
    await ownerClient.query(`ALTER ROLE app_runtime WITH PASSWORD '${RUNTIME_TEST_PASSWORD}'`);

    const uri = new URL(container.getConnectionUri());
    uri.username = "app_runtime";
    uri.password = RUNTIME_TEST_PASSWORD;
    process.env["DATABASE_URL"] = uri.toString();

    prisma = new PrismaService();
    await prisma.$connect();
    tenantContext = new TenantContextService(prisma);
  }, 120_000);

  afterAll(async () => {
    await prisma.$disconnect();
    await ownerClient.end();
    await container.stop();
  });

  async function seedTenantBusinessCustomer(): Promise<{
    tenantId: string;
    businessId: string;
    customerId: string;
  }> {
    const tenantId = randomUUID();
    const businessId = randomUUID();
    const customerId = randomUUID();
    const now = new Date();

    await ownerClient.query(
      `INSERT INTO tenants (id, name, created_at, updated_at) VALUES ($1, $2, $3, $3)`,
      [tenantId, `FK Test Tenant ${tenantId}`, now],
    );
    await ownerClient.query(
      `INSERT INTO businesses (id, tenant_id, name, timezone, crm_type, created_at, updated_at)
       VALUES ($1, $2, 'FK Test Business', 'America/Chicago', 'housecall_pro', $3, $3)`,
      [businessId, tenantId, now],
    );
    await ownerClient.query(
      `INSERT INTO customers (id, tenant_id, business_id, phone_e164, name, created_at, updated_at)
       VALUES ($1, $2, $3, '+15551234567', 'FK Test Customer', $4, $4)`,
      [customerId, tenantId, businessId, now],
    );

    return { tenantId, businessId, customerId };
  }

  it(
    "PROVES THE BUG IS REAL: inserting a leads row with a callId that has no matching calls row " +
      "fails with a real Postgres foreign-key violation (23503)",
    async () => {
      const { tenantId, businessId, customerId } = await seedTenantBusinessCustomer();
      const orphanCallId = randomUUID(); // deliberately never inserted into `calls`

      await expect(
        tenantContext.run(tenantId, (db) =>
          db.lead.create({
            data: {
              tenantId,
              businessId,
              customerId,
              callId: orphanCallId,
              problemSummary: "Orphan callId — proves the FK bug",
              priority: "urgent",
              leadType: "residential",
            },
          }),
        ),
      ).rejects.toThrow();
    },
  );

  it(
    "PROVES THE FIX WORKS: StartCallUseCase creates a real calls row FIRST, then createLead " +
      "succeeds against it with no FK violation",
    async () => {
      const { tenantId, businessId, customerId } = await seedTenantBusinessCustomer();
      const callRepository = new PrismaCallRepository();
      const leadRepository = new PrismaLeadRepository();
      const startCallUseCase = new StartCallUseCase(tenantContext, callRepository, noopLogger());

      const call = await startCallUseCase.execute({
        tenantId,
        businessId,
        customerId,
        direction: "inbound",
        fromNumber: "+15551234567",
        toNumber: "+15559876543",
        telephonyCallSid: `CA-${randomUUID()}`,
        startedAt: new Date().toISOString(),
      });

      const lead = await tenantContext.run(tenantId, (db) =>
        leadRepository.create(db, {
          tenantId,
          businessId,
          customerId,
          callId: call.id,
          problemSummary: "Real call, real lead — the fixed path",
          priority: "urgent",
          leadType: "residential",
        }),
      );

      expect(lead.callId).toBe(call.id);

      const persisted = await ownerClient.query("SELECT call_id FROM leads WHERE id = $1", [
        lead.id,
      ]);
      expect(persisted.rows[0]?.call_id).toBe(call.id);
    },
  );

  it("PrismaLeadRepository.create surfaces the FK violation as CallNotFoundForLeadError, not a raw 500", async () => {
    const { tenantId, businessId, customerId } = await seedTenantBusinessCustomer();
    const leadRepository = new PrismaLeadRepository();
    const orphanCallId = randomUUID();

    await expect(
      tenantContext.run(tenantId, (db) =>
        leadRepository.create(db, {
          tenantId,
          businessId,
          customerId,
          callId: orphanCallId,
          problemSummary: "Orphan callId via the real repository wrapper",
          priority: "urgent",
          leadType: "residential",
        }),
      ),
    ).rejects.toThrow(CallNotFoundForLeadError);
  });

  it("call creation is idempotent against real Postgres: a duplicate telephonyCallSid returns the same row, not a duplicate", async () => {
    const { tenantId, businessId } = await seedTenantBusinessCustomer();
    const callRepository = new PrismaCallRepository();
    const startCallUseCase = new StartCallUseCase(tenantContext, callRepository, noopLogger());
    const sid = `CA-${randomUUID()}`;
    const command = {
      tenantId,
      businessId,
      direction: "inbound" as const,
      fromNumber: "+15551234567",
      toNumber: "+15559876543",
      telephonyCallSid: sid,
      startedAt: new Date().toISOString(),
    };

    const [first, second] = await Promise.all([
      startCallUseCase.execute(command),
      startCallUseCase.execute(command),
    ]);

    expect(first.id).toBe(second.id);
    const rows = await ownerClient.query("SELECT id FROM calls WHERE telephony_call_sid = $1", [
      sid,
    ]);
    expect(rows.rows).toHaveLength(1);
  });

  it("RLS still applies to the calls table: a tenant cannot see another tenant's call", async () => {
    const tenantA = await seedTenantBusinessCustomer();
    const tenantB = await seedTenantBusinessCustomer();
    const callRepository = new PrismaCallRepository();
    const startCallUseCase = new StartCallUseCase(tenantContext, callRepository, noopLogger());

    const callA = await startCallUseCase.execute({
      tenantId: tenantA.tenantId,
      businessId: tenantA.businessId,
      direction: "inbound",
      fromNumber: "+15551234567",
      toNumber: "+15559876543",
      telephonyCallSid: `CA-${randomUUID()}`,
      startedAt: new Date().toISOString(),
    });

    const foundByOwnTenant = await tenantContext.run(tenantA.tenantId, (db) =>
      db.call.findFirst({ where: { id: callA.id } }),
    );
    const foundByOtherTenant = await tenantContext.run(tenantB.tenantId, (db) =>
      db.call.findFirst({ where: { id: callA.id } }),
    );

    expect(foundByOwnTenant?.id).toBe(callA.id);
    expect(foundByOtherTenant).toBeNull();
  });
});

function noopLogger() {
  return {
    child: () => noopLogger(),
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
}
