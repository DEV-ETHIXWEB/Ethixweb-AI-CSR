#!/usr/bin/env node
// Bootstraps ONE tenant end-to-end for local development / a first test
// call — docs/13-implementation-backlog.md's "Seed script for Phase 1
// pilot tenant" task, which had never actually been built (confirmed by
// repo search before writing this). Also closes the chicken-and-egg gap
// documented in apps/core-api/src/modules/auth/interfaces/auth.controller.ts's
// own comment: "Bootstrapping a brand-new tenant's very first user is
// deliberately NOT exposed [over HTTP]... see docs/13's seed-script task."
//
// Everything AFTER the first user is created by calling core-api's real,
// already-authenticated HTTP API (not a second, parallel write path) —
// the only genuinely bootstrap-only step is inserting that first owner
// user directly via Postgres, since no valid JWT can exist to call
// `POST /v1/auth/users` (owner/admin-gated) before one does.
//
// Requires core-api to already be running and reachable at CORE_API_BASE_URL
// (default http://localhost:3000), and MIGRATION_DATABASE_URL set (same var
// migrate:deploy/db:setup-local-runtime-role use) for the one direct insert.
//
// Usage: pnpm --filter @ethixweb/database run db:seed-local-pilot-tenant
// Configurable via env vars (all optional, sane local-dev defaults below):
//   SEED_TENANT_NAME, SEED_OWNER_EMAIL, SEED_OWNER_PASSWORD,
//   SEED_BUSINESS_NAME, SEED_BUSINESS_TIMEZONE, SEED_CRM_TYPE

import pg from "pg";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";

const BCRYPT_COST_FACTOR = 12; // must match apps/core-api's PasswordHash.hash()

const migrationUrl = process.env.MIGRATION_DATABASE_URL;
if (!migrationUrl) {
  console.error("MIGRATION_DATABASE_URL is not set — see .env.example.");
  process.exit(1);
}

const coreApiBaseUrl = (process.env.CORE_API_BASE_URL ?? "http://localhost:3000").replace(
  /\/$/,
  "",
);
const apiUrl = (path) => `${coreApiBaseUrl}/v1${path}`;

const tenantName = process.env.SEED_TENANT_NAME ?? "All Phase Plumbing (Local Dev)";
const ownerEmail = process.env.SEED_OWNER_EMAIL ?? "owner@allphaseplumbing.local";
const ownerPassword = process.env.SEED_OWNER_PASSWORD ?? "local-dev-owner-password-change-me";
const businessName = process.env.SEED_BUSINESS_NAME ?? "All Phase Plumbing — Main Office";
const businessTimezone = process.env.SEED_BUSINESS_TIMEZONE ?? "America/Chicago";
const crmType = process.env.SEED_CRM_TYPE ?? "housecall_pro";

async function postJson(path, body, token) {
  const res = await fetch(apiUrl(path), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    throw new Error(`POST ${path} -> ${res.status}: ${text}`);
  }
  return json;
}

async function main() {
  console.log(`Checking core-api is reachable at ${coreApiBaseUrl} ...`);
  const health = await fetch(`${coreApiBaseUrl}/readyz`).catch((error) => {
    throw new Error(
      `core-api is not reachable at ${coreApiBaseUrl} — start it first ` +
        `(pnpm --filter @ethixweb/core-api run start:dev). Original error: ${error.message}`,
    );
  });
  if (!health.ok) {
    throw new Error(`core-api readyz returned ${health.status} — is Postgres/Redis up?`);
  }

  console.log(`Creating tenant "${tenantName}" via POST /v1/tenants ...`);
  const tenant = await postJson("/tenants", { name: tenantName });
  console.log(`  tenant.id = ${tenant.id}`);

  console.log(`Inserting first owner user (${ownerEmail}) directly via Postgres ...`);
  console.log(
    "  (this ONE write bypasses the HTTP API — see this script's header comment for why " +
      "no HTTP path can exist for a tenant's very first user)",
  );
  const passwordHash = await bcrypt.hash(ownerPassword, BCRYPT_COST_FACTOR);
  const userId = randomUUID();
  const client = new pg.Client({ connectionString: migrationUrl });
  try {
    await client.connect();
    await client.query(
      `INSERT INTO users (id, tenant_id, email, password_hash, role, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'owner', now(), now())
       ON CONFLICT (tenant_id, email) DO NOTHING`,
      [userId, tenant.id, ownerEmail, passwordHash],
    );
  } finally {
    await client.end();
  }
  console.log(`  user.id = ${userId} (role: owner)`);

  console.log(`Logging in as ${ownerEmail} via POST /v1/auth/login ...`);
  const session = await postJson("/auth/login", {
    tenantId: tenant.id,
    email: ownerEmail,
    password: ownerPassword,
  });
  const accessToken = session.accessToken;
  if (!accessToken) {
    throw new Error(`Login succeeded but no accessToken in response: ${JSON.stringify(session)}`);
  }

  console.log(`Creating business "${businessName}" via POST /v1/businesses ...`);
  const business = await postJson(
    "/businesses",
    { name: businessName, timezone: businessTimezone, crmType },
    accessToken,
  );
  console.log(`  business.id = ${business.id}`);

  console.log("Adding a default emergency rule (burst pipe -> forward_call) ...");
  await postJson(
    "/emergency-rules",
    {
      businessId: business.id,
      keywordOrPattern: "burst pipe",
      severity: "critical",
      escalationAction: "forward_call",
    },
    accessToken,
  );

  console.log("Minting a core-api service API key (scopes: full) for voice-orchestrator ...");
  const apiKey = await postJson("/api-keys", { scopes: "full", expiresAt: null }, accessToken);

  console.log("\n=== Seed complete ===");
  console.log(`Tenant ID:        ${tenant.id}`);
  console.log(`Business ID:      ${business.id}`);
  console.log(`Owner email:      ${ownerEmail}`);
  console.log(`Owner password:   ${ownerPassword}`);
  console.log(`\nCORE_API_SERVICE_API_KEY (shown once — copy now):`);
  console.log(`  ${apiKey.plaintextKey}`);
  console.log(`\nNext steps:`);
  console.log(`  1. Set CORE_API_SERVICE_API_KEY in apps/voice-orchestrator/.env to the key above.`);
  console.log(
    `  2. Set TENANT_ROUTING_DEFAULT_TENANT_ID=${tenant.id} and ` +
      `TENANT_ROUTING_DEFAULT_BUSINESS_ID=${business.id} in apps/voice-runtime/.env.`,
  );
  console.log(`  3. Restart voice-orchestrator and voice-runtime.`);
}

main().catch((error) => {
  console.error("\nSeed failed:", error.message);
  process.exit(1);
});
