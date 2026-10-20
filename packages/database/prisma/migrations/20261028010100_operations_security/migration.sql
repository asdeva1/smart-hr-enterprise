-- Hand-written migration: row-level security and grants for the operations platform.

ALTER TABLE "ops_workspace" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ops_workspace"
    FOR ALL USING ("tenant_id" = app_current_tenant_id()) WITH CHECK ("tenant_id" = app_current_tenant_id());

ALTER TABLE "ops_stage" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ops_stage"
    FOR ALL USING ("tenant_id" = app_current_tenant_id()) WITH CHECK ("tenant_id" = app_current_tenant_id());

ALTER TABLE "ops_field" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ops_field"
    FOR ALL USING ("tenant_id" = app_current_tenant_id()) WITH CHECK ("tenant_id" = app_current_tenant_id());

ALTER TABLE "ops_item" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ops_item"
    FOR ALL USING ("tenant_id" = app_current_tenant_id()) WITH CHECK ("tenant_id" = app_current_tenant_id());

ALTER TABLE "ops_item_event" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ops_item_event"
    FOR ALL USING ("tenant_id" = app_current_tenant_id()) WITH CHECK ("tenant_id" = app_current_tenant_id());

-- Workspaces and items are never deleted (a workspace is archived). Stages and fields can be redefined.
-- The history of an item only grows.
GRANT SELECT, INSERT, UPDATE ON "ops_workspace" TO app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON "ops_stage" TO app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON "ops_field" TO app_rw;
GRANT SELECT, INSERT, UPDATE ON "ops_item" TO app_rw;
GRANT SELECT, INSERT ON "ops_item_event" TO app_rw;

-- An item's stage must belong to the item's own workspace.
CREATE FUNCTION ops_item_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM "ops_stage" s WHERE s."id" = NEW."stage_id" AND s."workspace_id" = NEW."workspace_id"
        ) THEN
            RAISE EXCEPTION 'stage belongs to another workspace' USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
    END $$;

CREATE TRIGGER ops_item_check
    BEFORE INSERT OR UPDATE OF "stage_id" ON "ops_item"
    FOR EACH ROW EXECUTE FUNCTION ops_item_guard();
