import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Client } from "pg";
import { PrismaService } from "../../src/shared/prisma/prisma.service";
import { TenantContextService } from "../../src/shared/prisma/tenant-context.service";
import { EndCallUseCase } from "../../src/modules/calls/application/end-call.use-case";
import { createNoopLogger } from "../../src/modules/calls/application/__fakes__/fake-logger";
import { PrismaCallRepository } from "../../src/modules/calls/infrastructure/prisma-call.repository";
import { IllegalCallStatusTransitionError } from "../../src/modules/calls/domain/call-lifecycle";

/**
 * Proves, against a real Postgres, a real production bug found live: two
 * concurrent end-call requests with DIFFERENT terminal statuses (e.g. a
 * normal "completed" signal racing an "abandoned" disconnect signal) could
 * both read the call's status as `in_progress`, both pass the domain
 * transition check, and both write — the previous `PrismaCallRepository.
 * updateStatus` did a blind `updateMany({ where: { id, tenantId } })` with
 * no compare-and-swap on the status actually read, so whichever write
 * committed last silently overwrote the other's terminal status. A unit
 * test against FakeCallRepository (a synchronous in-memory map) cannot
 * exercise a true concurrent-transaction race — only a real database, with
 * two real overlapping Postgres transactions, can prove the fix actually
 * serializes them correctly.
 *
 * Requires Docker. Run locally with:
 *   pnpm --filter @ethixweb/core-api run test:integration
 */

const MIGRATIONS_DIR = path.resolve(__dirname, "../../../../packages/database/prisma/migrations");
const RUNTIME_TEST_PASSWORD = "integration_test_app_runtime_only";

describe("Call end-status race (integration, real Postgres, real concurrent transactions)", () => {
  let container: StartedPostgreSqlContainer;
  let ownerClient: Client;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:16-alpine").start();

    ownerClient = new Client({ connectionString: container.getConnectionUri() });
    await ownerClient.connect();

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

  async function seedInProgressCall(): Promise<{
    tenantId: string;
    businessId: string;
    telephonyCallSid: string;
  }> {
    const tenantId = randomUUID();
    const businessId = randomUUID();
    const callId = randomUUID();
    const telephonyCallSid = `CA-${randomUUID()}`;
    const now = new Date();
    await ownerClient.query(
      `INSERT INTO tenants (id, name, created_at, updated_at) VALUES ($1, $2, $3, $3)`,
      [tenantId, "Race Test Tenant", now],
    );
    await ownerClient.query(
      `INSERT INTO businesses (id, tenant_id, name, timezone, crm_type, created_at, updated_at)
       VALUES ($1, $2, $3, 'America/Chicago', 'housecall_pro', $4, $4)`,
      [businessId, tenantId, "Race Test Tenant — Main Office", now],
    );
    await ownerClient.query(
      `INSERT INTO calls (id, tenant_id, business_id, direction, from_number, to_number, telephony_call_sid, status, started_at)
       VALUES ($1, $2, $3, 'inbound', '+15551234567', '+15559876543', $4, 'in_progress', $5)`,
      [callId, tenantId, businessId, telephonyCallSid, now],
    );
    return { tenantId, businessId, telephonyCallSid };
  }

  it("never corrupts the call's final status under two genuinely concurrent, conflicting end-call requests", async () => {
    const { tenantId, telephonyCallSid } = await seedInProgressCall();

    process.env["DATABASE_URL"] = appRuntimeConnectionString();
    const prisma = new PrismaService();
    await prisma.$connect();
    const tenantContext = new TenantContextService(prisma);
    const callRepository = new PrismaCallRepository();
    const useCase = new EndCallUseCase(tenantContext, callRepository, createNoopLogger());

    try {
      const results = await Promise.allSettled([
        useCase.execute({
          tenantId,
          telephonyCallSid,
          status: "completed",
          endReason: "caller_hangup",
          endedAt: new Date().toISOString(),
        }),
        useCase.execute({
          tenantId,
          telephonyCallSid,
          status: "abandoned",
          endReason: "runtime_disconnected",
          endedAt: new Date().toISOString(),
        }),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");

      // Exactly one of the two conflicting terminal statuses must win —
      // never both silently succeeding (the corruption this fix prevents),
      // and never both failing (the call would be stuck un-endable).
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
        IllegalCallStatusTransitionError,
      );

      const winnerStatus = (fulfilled[0] as PromiseFulfilledResult<{ status: string }>).value
        .status;
      expect(["completed", "abandoned"]).toContain(winnerStatus);

      // The database's own row must agree with whichever request actually won.
      const row = await ownerClient.query(
        `SELECT status FROM calls WHERE telephony_call_sid = $1`,
        [telephonyCallSid],
      );
      expect(row.rows[0].status).toBe(winnerStatus);
    } finally {
      await prisma.$disconnect();
    }
  });
});
