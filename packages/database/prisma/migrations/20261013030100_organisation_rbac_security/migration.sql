-- Hand-written migration: row-level security and grants for organisation structure and roles.
--
-- Every table carries tenant_id and is isolated by the standard policy. Cross-table references are
-- tenant-qualified foreign keys (see the previous migration), because foreign-key checks bypass RLS:
-- without them a row in tenant A could point at a row in tenant B.

ALTER TABLE "company" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "company"
    FOR ALL
    USING ("tenant_id" = app_current_tenant_id())
    WITH CHECK ("tenant_id" = app_current_tenant_id());

ALTER TABLE "branch" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "branch"
    FOR ALL
    USING ("tenant_id" = app_current_tenant_id())
    WITH CHECK ("tenant_id" = app_current_tenant_id());

ALTER TABLE "department" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "department"
    FOR ALL
    USING ("tenant_id" = app_current_tenant_id())
    WITH CHECK ("tenant_id" = app_current_tenant_id());

ALTER TABLE "role" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "role"
    FOR ALL
    USING ("tenant_id" = app_current_tenant_id())
    WITH CHECK ("tenant_id" = app_current_tenant_id());

ALTER TABLE "role_permission" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "role_permission"
    FOR ALL
    USING ("tenant_id" = app_current_tenant_id())
    WITH CHECK ("tenant_id" = app_current_tenant_id());

ALTER TABLE "role_assignment" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "role_assignment"
    FOR ALL
    USING ("tenant_id" = app_current_tenant_id())
    WITH CHECK ("tenant_id" = app_current_tenant_id());

-- No DELETE on organisation records: they are archived so history and references survive.
GRANT SELECT, INSERT, UPDATE ON "company", "branch", "department" TO app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON "role", "role_permission", "role_assignment" TO app_rw;

-- Organisation owners may change their own tenant's security policy, and nothing else on the tenant row.
GRANT UPDATE ("require_mfa", "updated_at") ON "tenant" TO app_rw;
CREATE POLICY tenant_self_update ON "tenant"
    FOR UPDATE
    USING ("id" = app_current_tenant_id())
    WITH CHECK ("id" = app_current_tenant_id());
