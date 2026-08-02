-- Extends Row-Level Security to `usage_records` — a NEW migration, not an
-- edit to 00000000000002_rls_policies, per docs/15-tenant-lifecycle-billing-and-analytics.md
-- §5.1's expand/contract discipline (a migration already applied in any
-- real environment is never retroactively rewritten). Identical policy
-- shape and reasoning as every other tenant-scoped table — see that
-- migration's own header comment for the full two-role-model explanation
-- (app_runtime, tenant_isolation predicate, missing_ok fail-closed default).

ALTER TABLE "usage_records" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "usage_records"
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON "usage_records" TO app_runtime;
