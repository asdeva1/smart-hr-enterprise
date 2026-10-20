-- Hand-written migration: row-level security and grants for vendors and expenses.

ALTER TABLE "vendor" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "vendor"
    FOR ALL
    USING ("tenant_id" = app_current_tenant_id())
    WITH CHECK ("tenant_id" = app_current_tenant_id());

ALTER TABLE "expense_category" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "expense_category"
    FOR ALL
    USING ("tenant_id" = app_current_tenant_id())
    WITH CHECK ("tenant_id" = app_current_tenant_id());

ALTER TABLE "expense_claim" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "expense_claim"
    FOR ALL
    USING ("tenant_id" = app_current_tenant_id())
    WITH CHECK ("tenant_id" = app_current_tenant_id());

ALTER TABLE "expense_line" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "expense_line"
    FOR ALL
    USING ("tenant_id" = app_current_tenant_id())
    WITH CHECK ("tenant_id" = app_current_tenant_id());

-- Vendors and categories are archived, never deleted. Claims are kept; draft lines can be replaced.
GRANT SELECT, INSERT, UPDATE ON "vendor" TO app_rw;
GRANT SELECT, INSERT, UPDATE ON "expense_category" TO app_rw;
GRANT SELECT, INSERT, UPDATE ON "expense_claim" TO app_rw;
GRANT SELECT, INSERT, DELETE ON "expense_line" TO app_rw;
