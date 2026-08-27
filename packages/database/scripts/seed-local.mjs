#!/usr/bin/env node
// Seeds a local-development tenant, an `owner` user, and one business, so
// the API's authenticated surface is reachable at all.
//
// Why this exists: `POST /v1/tenants` is the only unauthenticated endpoint
// (and deliberately so — see the comment on that handler), but creating a
// tenant does not create a user for it, and `POST /v1/auth/users` requires
// an existing owner/admin JWT for the tenant it is inviting into. That is a
// closed loop: on a fresh database there is no way to obtain a first
// credential through the API, so every authenticated route is unreachable.
// This script is the out-of-band bootstrap for local development only.
//
// LOCAL DEVELOPMENT ONLY. It writes a known, committed password directly
// into the database. Real environments create their first tenant/owner
// through the ops-driven onboarding flow in
// docs/15-tenant-lifecycle-billing-and-analytics.md §1 — never this.
//
// Run after `migrate:dev` and `db:setup-local-runtime-role`:
//   pnpm --filter @ethixweb/database run seed:local
//
// Override any of the defaults via the environment:
//   SEED_TENANT_NAME, SEED_EMAIL, SEED_PASSWORD, SEED_BUSINESS_NAME,
//   SEED_BUSINESS_TIMEZONE, SEED_BUSINESS_CRM_TYPE

import { existsSync } from "node:fs";
import { join } from "node:path";
import bcrypt from "bcryptjs";
import pg from "pg";

// Same root-`.env` load as prisma.config.ts and setup-local-runtime-role.mjs
// — this script's cwd is `packages/database`, the `.env` is at the repo root.
const rootEnvFile = join(import.meta.dirname, "../../../.env");
if (existsSync(rootEnvFile)) {
  process.loadEnvFile(rootEnvFile);
}

// Deliberately the MIGRATION (owner) URL, not DATABASE_URL: the owner
// bypasses Row-Level Security, which is what lets this insert a tenant's
// first rows before any authenticated tenant context exists to scope them.
// The app's own `app_runtime` role could not do this — by design
// (docs/20-architecture-decision-records.md ADR-013/ADR-014).
const migrationUrl = process.env.MIGRATION_DATABASE_URL;
if (!migrationUrl) {
  console.error("MIGRATION_DATABASE_URL is not set — see .env.example.");
  process.exit(1);
}

const tenantName = process.env.SEED_TENANT_NAME ?? "Local Dev Plumbing Co";
// Lowercased to match Email.create()'s normalization — the login lookup is a
// plain equality match on the stored value, so a mixed-case seed row would
// simply never be found.
const email = (process.env.SEED_EMAIL ?? "owner@example.com").trim().toLowerCase();
const password = process.env.SEED_PASSWORD ?? "local_dev_password_123";
const businessName = process.env.SEED_BUSINESS_NAME ?? "Local Dev Plumbing — Main Office";
const businessTimezone = process.env.SEED_BUSINESS_TIMEZONE ?? "America/Chicago";
const businessCrmType = process.env.SEED_BUSINESS_CRM_TYPE ?? "housecall_pro";

// PasswordHash enforces this same minimum (NIST 800-63B favors length over
// composition rules). Checked here too so a bad SEED_PASSWORD fails now,
// with a clear message, rather than at the first login attempt.
const MIN_PASSWORD_LENGTH = 12;
if (password.length < MIN_PASSWORD_LENGTH) {
  console.error(`SEED_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  process.exit(1);
}

// Must match PasswordHash's BCRYPT_COST_FACTOR. Any bcrypt hash verifies
// regardless of the cost it was generated with, so this is about keeping
// seeded rows indistinguishable from real ones, not correctness.
const BCRYPT_COST_FACTOR = 12;

const client = new pg.Client({ connectionString: migrationUrl });

try {
  await client.connect();
  await client.query("BEGIN");

  // Re-runnable: reuse the tenant if this seed already created one by that
  // name, so running it twice doesn't accumulate near-duplicate tenants
  // that then make `tenantId` ambiguous at login.
  const existingTenant = await client.query(`SELECT id FROM tenants WHERE name = $1 LIMIT 1`, [
    tenantName,
  ]);
  const tenantId =
    existingTenant.rows[0]?.id ??
    (
      await client.query(
        `INSERT INTO tenants (id, name, plan_tier, status, updated_at)
         VALUES (gen_random_uuid(), $1, 'trial', 'trial', CURRENT_TIMESTAMP)
         RETURNING id`,
        [tenantName],
      )
    ).rows[0].id;

  const passwordHash = await bcrypt.hash(password, BCRYPT_COST_FACTOR);

  // ON CONFLICT against the real `@@unique([tenantId, email])` constraint —
  // re-running resets the password rather than failing, which is the useful
  // behaviour when you've forgotten what you seeded.
  const user = await client.query(
    `INSERT INTO users (id, tenant_id, email, password_hash, role, updated_at)
     VALUES (gen_random_uuid(), $1, $2, $3, 'owner', CURRENT_TIMESTAMP)
     ON CONFLICT (tenant_id, email)
       DO UPDATE SET password_hash = EXCLUDED.password_hash, updated_at = CURRENT_TIMESTAMP
     RETURNING id`,
    [tenantId, email, passwordHash],
  );

  const existingBusiness = await client.query(
    `SELECT id FROM businesses WHERE tenant_id = $1 AND name = $2 LIMIT 1`,
    [tenantId, businessName],
  );
  const businessId =
    existingBusiness.rows[0]?.id ??
    (
      await client.query(
        `INSERT INTO businesses (id, tenant_id, name, timezone, crm_type, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, CURRENT_TIMESTAMP)
         RETURNING id`,
        [tenantId, businessName, businessTimezone, businessCrmType],
      )
    ).rows[0].id;

  await client.query("COMMIT");

  console.log(`
Local development seed complete.

  tenantId    ${tenantId}
  businessId  ${businessId}
  userId      ${user.rows[0].id}
  email       ${email}
  password    ${password}
  role        owner

Log in at POST /v1/auth/login with this exact body:

{
  "tenantId": "${tenantId}",
  "email": "${email}",
  "password": "${password}"
}

Then paste the returned accessToken into Swagger's "Authorize" button
(bearer) at http://localhost:3000/docs/api to unlock every other route.
`);
} catch (error) {
  await client.query("ROLLBACK").catch(() => {
    // The connection itself may already be unusable (e.g. the tables don't
    // exist yet); the original error below is the one worth reporting.
  });
  console.error(
    "Seed failed. Common cause: migrations haven't been run yet — run " +
      "`pnpm --filter @ethixweb/database run migrate:dev` first.",
  );
  console.error(error);
  process.exit(1);
} finally {
  await client.end();
}
