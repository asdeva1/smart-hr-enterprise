-- Hand-written migration: row-level security for tenant isolation.
-- Prisma does not model RLS, so these statements never appear in schema drift checks.
--
-- The API sets the tenant per transaction with:
--   SELECT set_config('app.tenant_id', '<uuid>', true);
-- Without that setting, the helper returns NULL and every policy matches no rows (fail closed).
--
-- RLS binds the runtime role `app_rw`, which owns nothing and cannot bypass RLS
-- (asserted by packages/database/test/rls.int.test.ts). The schema owner `app_migrator`
-- is exempt as table owner; it is used only for migrations and test fixtures, never at runtime.

CREATE FUNCTION app_current_tenant_id() RETURNS uuid
    LANGUAGE sql STABLE
    AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

-- tenant: a session may only read its own tenant row. Creating tenants is a platform operation (Phase 6).
ALTER TABLE "tenant" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_self_read ON "tenant"
    FOR SELECT
    USING ("id" = app_current_tenant_id());

-- tenant_setting: full tenant isolation for reads and writes.
ALTER TABLE "tenant_setting" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "tenant_setting"
    FOR ALL
    USING ("tenant_id" = app_current_tenant_id())
    WITH CHECK ("tenant_id" = app_current_tenant_id());

-- Runtime role privileges. The roles themselves are created by sql/bootstrap-roles.sql.
GRANT EXECUTE ON FUNCTION app_current_tenant_id() TO app_rw;
GRANT SELECT ON "tenant" TO app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON "tenant_setting" TO app_rw;
