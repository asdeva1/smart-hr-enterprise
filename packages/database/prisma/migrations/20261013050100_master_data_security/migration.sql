-- Hand-written migration: row-level security and grants for master data.

ALTER TABLE "lookup_value" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "lookup_value"
    FOR ALL
    USING ("tenant_id" = app_current_tenant_id())
    WITH CHECK ("tenant_id" = app_current_tenant_id());

-- No DELETE: values are archived, so records that use them keep their meaning.
-- The list and code identify a value everywhere and never change once created.
GRANT SELECT, INSERT ON "lookup_value" TO app_rw;
GRANT UPDATE ("name", "description", "sort_order", "status", "updated_at") ON "lookup_value" TO app_rw;
