-- Hand-written migration: row-level security, grants and the one-open-assignment rule for assets.

ALTER TABLE "asset" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "asset"
    FOR ALL
    USING ("tenant_id" = app_current_tenant_id())
    WITH CHECK ("tenant_id" = app_current_tenant_id());

ALTER TABLE "asset_assignment" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "asset_assignment"
    FOR ALL
    USING ("tenant_id" = app_current_tenant_id())
    WITH CHECK ("tenant_id" = app_current_tenant_id());

-- Assets are retired, never deleted. An assignment is history: it can only be closed by recording the return.
GRANT SELECT, INSERT, UPDATE ON "asset" TO app_rw;
GRANT SELECT, INSERT ON "asset_assignment" TO app_rw;
GRANT UPDATE ("returned_on", "condition_in", "returned_by_user_id") ON "asset_assignment" TO app_rw;

-- An asset is with at most one person at a time, whatever the application does.
CREATE FUNCTION asset_assignment_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
        IF NEW."returned_on" IS NULL AND EXISTS (
            SELECT 1 FROM "asset_assignment" a
            WHERE a."asset_id" = NEW."asset_id" AND a."returned_on" IS NULL AND a."id" <> NEW."id"
        ) THEN
            RAISE EXCEPTION 'asset % is already assigned', NEW."asset_id" USING ERRCODE = 'unique_violation';
        END IF;
        RETURN NEW;
    END
    $$;

CREATE TRIGGER asset_assignment_check
    BEFORE INSERT ON "asset_assignment"
    FOR EACH ROW EXECUTE FUNCTION asset_assignment_guard();
