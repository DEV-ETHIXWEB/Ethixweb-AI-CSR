-- Row-Level Security policies, per docs/06-database-schema.md §1 and
-- docs/20-architecture-decision-records.md ADR-013/ADR-014.
--
-- Not managed by Prisma (it has no native RLS support), applied as a
-- hand-written migration immediately after the schema migration.
--
-- ---------------------------------------------------------------------------
-- Two-role model (why `app_runtime` exists, and why FORCE ROW LEVEL SECURITY
-- is deliberately NOT used):
-- ---------------------------------------------------------------------------
-- Migrations run as the table-owning role (MIGRATION_DATABASE_URL, never
-- DATABASE_URL -- see prisma.config.ts's own comment on why those must stay
-- two different roles). RLS policies never restrict a table's owner by
-- default -- FORCE ROW LEVEL SECURITY exists specifically to close that
-- hole, but forcing it here would also block the migration role's own
-- schema/data operations. Instead, the application connects at runtime as a
-- separate, deliberately non-owning `app_runtime` role, which is subject to
-- RLS by default (no FORCE needed) purely because it isn't the owner and
-- has no BYPASSRLS attribute. This is the standard, safer pattern: migration
-- privilege and runtime privilege are two different roles, not two modes of
-- the same one.
--
-- `app_runtime`'s password is NOT set here (a migration file is
-- version-controlled and must never contain a real credential) -- it is
-- rotated and injected via Secrets Manager per docs/08-security-observability-reliability.md
-- §1.2 in every real environment, applied out-of-band with
-- `ALTER ROLE app_runtime WITH PASSWORD '...'` as part of environment
-- provisioning (docs/10-deployment-cicd.md §5, Terraform). For local
-- development, run `pnpm --filter @ethixweb/database run
-- db:setup-local-runtime-role` once after this migration applies --
-- packages/database/scripts/setup-local-runtime-role.mjs sets a
-- non-secret, dev-only password so RLS is actually exercised locally
-- instead of silently bypassed by connecting as the table owner.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    CREATE ROLE app_runtime WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO app_runtime;

-- Every tenant-scoped table below gets the identical predicate, per ADR-013
-- (tenant_id is denormalized onto all of them specifically so this is
-- uniform, never a subquery-join through business_id). `current_setting`'s
-- second argument (`missing_ok = true`) makes an unset session variable
-- evaluate to NULL rather than raising -- NULL never equals a real tenant_id,
-- so a connection that never called TenantContextService.run() simply sees
-- zero rows (fail closed), not an error that could crash an unrelated query.
--
-- `api_keys` gets this same policy too (management operations -- list/create/
-- revoke a tenant's own keys -- are properly tenant-scoped like everything
-- else), but ALSO needs a narrow, separate escape hatch below for
-- authentication itself: a caller presenting an API key doesn't know their
-- own tenant_id yet -- that's precisely what the key lookup exists to
-- resolve -- so the one query that finds a key by its hash structurally
-- cannot have `app.tenant_id` set before it runs. See
-- docs/20-architecture-decision-records.md ADR-015 for the full reasoning.
DO $$
DECLARE
  tenant_scoped_table TEXT;
BEGIN
  FOREACH tenant_scoped_table IN ARRAY ARRAY[
    'businesses', 'users', 'api_keys',
    'integrations', 'agent_configs', 'emergency_rules', 'business_hours',
    'oncall_rotations', 'oncall_shifts', 'notification_channels', 'notifications',
    'customers', 'calls', 'voice_sessions', 'transcripts', 'tool_calls',
    'leads', 'lead_claims', 'crm_sync_log', 'audit_logs',
    'webhook_subscriptions', 'webhook_deliveries'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tenant_scoped_table);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)::uuid)',
      tenant_scoped_table
    );
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_runtime', tenant_scoped_table);
  END LOOP;
END
$$;

-- Narrow, purpose-built escape hatch for API-key authentication (ADR-015):
-- SECURITY DEFINER makes this function run with its OWNER's privileges (the
-- table-owning migration role), which bypasses RLS -- but the function's
-- surface is fixed and minimal: an exact key_hash match, returning only the
-- columns needed to authenticate and resolve the caller's tenant_id, never
-- an arbitrary filter or the key_hash itself. `SET search_path = public`
-- prevents a search-path-hijacking attack against a SECURITY DEFINER
-- function (a well-known Postgres footgun if omitted). This is the only
-- code path in the entire schema permitted to read api_keys without tenant
-- context already set -- every other access (list/create/revoke a tenant's
-- own keys) goes through the normal RLS-protected policy above.
CREATE OR REPLACE FUNCTION lookup_api_key_for_auth(p_key_hash TEXT)
RETURNS TABLE (id UUID, tenant_id UUID, scopes TEXT, revoked_at TIMESTAMPTZ, expires_at TIMESTAMPTZ)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT api_keys.id, api_keys.tenant_id, api_keys.scopes, api_keys.revoked_at, api_keys.expires_at
  FROM api_keys
  WHERE api_keys.key_hash = p_key_hash;
$$;

REVOKE ALL ON FUNCTION lookup_api_key_for_auth(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lookup_api_key_for_auth(TEXT) TO app_runtime;

-- `tenants` is the root of multi-tenancy and deliberately has no tenant_id
-- column and no RLS policy (ADR-013) -- access control there is app-layer
-- only. `app_runtime` still needs ordinary table privileges on it.
GRANT SELECT, INSERT, UPDATE, DELETE ON tenants TO app_runtime;

-- `audit_logs` is additionally append-only at the database-role level, per
-- docs/08-security-observability-reliability.md §1.7 -- UPDATE/DELETE are
-- revoked from app_runtime even though the loop above granted them, so this
-- explicitly narrows that one table's privileges back down.
REVOKE UPDATE, DELETE ON audit_logs FROM app_runtime;

-- Platform-infrastructure tables (docs/01-architecture-overview.md §5/§7,
-- see the schema.prisma file-level comment) are processed only by trusted
-- internal workers, never through tenant-scoped application code paths --
-- RLS is intentionally not applied to them, but app_runtime still needs
-- ordinary privileges since the outbox relay and webhook receiver run as
-- this same role.
GRANT SELECT, INSERT, UPDATE, DELETE ON webhook_events TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON outbox_events TO app_runtime;

-- Sequences aren't used (every PK is a Prisma-generated UUID default), so no
-- sequence grants are required. Future tables added via the expand/contract
-- migration discipline (docs/15-tenant-lifecycle-billing-and-analytics.md §5.1)
-- must add themselves to this pattern explicitly in their own migration --
-- there is intentionally no default-privileges rule that would silently grant
-- access to a table added later without an explicit RLS policy decision.
