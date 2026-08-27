#!/usr/bin/env node
// Sets a known, local-development-only password for the `app_runtime`
// Postgres role created by the RLS migration
// (prisma/migrations/00000000000002_rls_policies).
//
// Why this exists: the role is deliberately created with NO password in the
// migration itself (a version-controlled SQL file must never contain a real
// credential — see that migration's own header comment). In every real
// environment, the password is set out-of-band via Secrets Manager
// (docs/08-security-observability-reliability.md §1.2). Local development
// has no Secrets Manager, so this script is the out-of-band step for that
// one case — the password it sets is not a secret (it's committed in
// .env.example) and must never be reused anywhere but a developer's own
// docker-compose Postgres.
//
// Run after `pnpm --filter @ethixweb/database run migrate:dev` (or
// migrate:deploy), using the MIGRATION_DATABASE_URL (owner) credential —
// only the owner can ALTER another role.

import { existsSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

// Same root-`.env` load as seed-local.mjs and prisma.config.ts — this
// script's cwd is packages/database, the `.env` is at the repo root.
const rootEnvFile = join(import.meta.dirname, "../../../.env");
if (existsSync(rootEnvFile)) {
  process.loadEnvFile(rootEnvFile);
}

const migrationUrl = process.env.MIGRATION_DATABASE_URL;
if (!migrationUrl) {
  console.error("MIGRATION_DATABASE_URL is not set — see .env.example.");
  process.exit(1);
}

const runtimePassword = process.env.LOCAL_APP_RUNTIME_PASSWORD ?? "local_dev_only_app_runtime";

const client = new pg.Client({ connectionString: migrationUrl });

try {
  await client.connect();
  await client.query(
    `ALTER ROLE app_runtime WITH PASSWORD '${runtimePassword.replace(/'/g, "''")}'`,
  );
  console.log(
    'app_runtime password set for local development. Ensure DATABASE_URL in your .env ' +
      "connects as app_runtime (not the migration owner) — see .env.example.",
  );
} catch (error) {
  console.error(
    "Failed to set app_runtime's local password. Common cause: migrations haven't been run " +
      "yet (the role doesn't exist until the RLS migration creates it) — run " +
      "`pnpm --filter @ethixweb/database run migrate:dev` first.",
  );
  console.error(error);
  process.exit(1);
} finally {
  await client.end();
}
