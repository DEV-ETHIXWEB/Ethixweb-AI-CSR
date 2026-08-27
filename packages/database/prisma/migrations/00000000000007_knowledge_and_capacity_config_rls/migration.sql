-- Extends Row-Level Security to `knowledge_items` and
-- `tenant_capacity_configs` — a NEW migration, not an edit to
-- 00000000000006_knowledge_and_capacity_config, per the same expand/
-- contract discipline as 00000000000005_usage_records_rls (a migration
-- already applied in any real environment is never retroactively
-- rewritten). Identical policy shape/reasoning as every other tenant-scoped
-- table — see 00000000000002_rls_policies/migration.sql's own header
-- comment for the full two-role-model explanation.

ALTER TABLE "knowledge_items" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "knowledge_items"
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON "knowledge_items" TO app_runtime;

ALTER TABLE "tenant_capacity_configs" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "tenant_capacity_configs"
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON "tenant_capacity_configs" TO app_runtime;
