-- Fly.io Managed Postgres variant of the RLS migrations
-- (00000000000002_rls_policies and 00000000000005_usage_records_rls).
--
-- WHY THIS FILE EXISTS
-- Fly MPG imposes two limits the original migrations cannot satisfy:
--   1. no available role holds CREATEROLE, so `CREATE ROLE app_runtime`
--      fails; and
--   2. a role created through `fly mpg users create` is an MPG system
--      role, and any GRANT to it fails with "MPG system roles cannot be
--      modified" — including GRANTs issued dynamically from inside a
--      PL/pgSQL block, which is how the original migration grants each
--      tenant-scoped table.
--
-- WHY DROPPING THOSE PARTS IS SAFE (verified against the live cluster,
-- not assumed):
--   * `app_runtime` is created with `fly mpg users create --role writer`
--     and was confirmed rolsuper=f, rolbypassrls=f, and not the table
--     owner — exactly the properties ADR-013/ADR-014 depend on for RLS to
--     actually bind to it.
--   * every privilege the removed GRANTs would confer is already held via
--     Fly's `writer` role: has_schema_privilege/has_table_privilege
--     returned true for schema USAGE and for SELECT/INSERT/UPDATE/DELETE
--     on tenants, leads, outbox_events and webhook_events. Functions
--     grant EXECUTE to PUBLIC by default, covering the function GRANT.
--
-- So what is preserved below is the entire security-relevant half —
-- ENABLE ROW LEVEL SECURITY plus the tenant_isolation policy on every
-- tenant-scoped table — and only the redundant privilege plumbing is
-- dropped.
--
-- IDEMPOTENT: safe to re-run. An earlier partial attempt left one table
-- with RLS already enabled, so every statement guards itself rather than
-- assuming a clean database.
--
-- Apply with the OWNER credential (MIGRATION_DATABASE_URL), then:
--   prisma migrate resolve --applied 00000000000002_rls_policies
--   prisma migrate resolve --applied 00000000000005_usage_records_rls

-- ---------------------------------------------------------------------
-- Tenant-scoped tables (from 00000000000002_rls_policies)
-- ---------------------------------------------------------------------
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
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = tenant_scoped_table
        AND policyname = 'tenant_isolation'
    ) THEN
      EXECUTE format(
        'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)::uuid)',
        tenant_scoped_table
      );
    END IF;
    -- GRANT deliberately omitted — see this file's header.
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------
-- usage_records (from 00000000000005_usage_records_rls)
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'usage_records') THEN
    EXECUTE 'ALTER TABLE usage_records ENABLE ROW LEVEL SECURITY';
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'usage_records' AND policyname = 'tenant_isolation'
    ) THEN
      EXECUTE 'CREATE POLICY tenant_isolation ON usage_records USING (tenant_id = current_setting(''app.tenant_id'', true)::uuid)';
    END IF;
  END IF;
END
$$;

-- ---------------------------------------------------------------------
-- knowledge_items / tenant_capacity_configs
-- (from 00000000000007_knowledge_and_capacity_config_rls — same two
-- blocked GRANTs, same reasoning)
-- ---------------------------------------------------------------------
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['knowledge_items', 'tenant_capacity_configs']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = t) THEN
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
      IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = t AND policyname = 'tenant_isolation'
      ) THEN
        EXECUTE format(
          'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)::uuid)',
          t
        );
      END IF;
    END IF;
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------
-- Verification — every row must report rls_enabled = t and has_policy = t
-- ---------------------------------------------------------------------
SELECT c.relname AS table_name,
       c.relrowsecurity AS rls_enabled,
       EXISTS (
         SELECT 1 FROM pg_policies p
         WHERE p.schemaname = 'public' AND p.tablename = c.relname
           AND p.policyname = 'tenant_isolation'
       ) AS has_policy
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relname IN (
    'businesses','users','api_keys','integrations','agent_configs','emergency_rules',
    'business_hours','oncall_rotations','oncall_shifts','notification_channels','notifications',
    'customers','calls','voice_sessions','transcripts','tool_calls','leads','lead_claims',
    'crm_sync_log','audit_logs','webhook_subscriptions','webhook_deliveries','usage_records',
    'knowledge_items','tenant_capacity_configs'
  )
ORDER BY c.relname;
