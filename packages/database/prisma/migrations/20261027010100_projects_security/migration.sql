-- Hand-written migration: row-level security, grants and the time rules for projects and timesheets.

ALTER TABLE "project" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "project"
    FOR ALL
    USING ("tenant_id" = app_current_tenant_id())
    WITH CHECK ("tenant_id" = app_current_tenant_id());

ALTER TABLE "project_member" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "project_member"
    FOR ALL
    USING ("tenant_id" = app_current_tenant_id())
    WITH CHECK ("tenant_id" = app_current_tenant_id());

ALTER TABLE "time_entry" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "time_entry"
    FOR ALL
    USING ("tenant_id" = app_current_tenant_id())
    WITH CHECK ("tenant_id" = app_current_tenant_id());

-- Projects are archived, never deleted. Members can be removed. Open time can be corrected or deleted.
GRANT SELECT, INSERT, UPDATE ON "project" TO app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON "project_member" TO app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON "time_entry" TO app_rw;

ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_minutes_range" CHECK ("minutes" BETWEEN 1 AND 1440);
ALTER TABLE "project" ADD CONSTRAINT "project_dates_order" CHECK ("end_date" IS NULL OR "start_date" IS NULL OR "end_date" >= "start_date");

-- Nobody can log more than 24 hours in a day, even when two requests arrive together: entries for one person
-- and day are serialised, then the day's total is checked. Approved time can't be changed or removed by the
-- application; the owner role can, so that an organisation's data can still be erased.
CREATE FUNCTION time_entry_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    DECLARE
        total integer;
    BEGIN
        IF TG_OP = 'DELETE' THEN
            IF OLD."status" = 'APPROVED' AND current_user = 'app_rw' THEN
                RAISE EXCEPTION 'approved time cannot be removed' USING ERRCODE = 'check_violation';
            END IF;
            RETURN OLD;
        END IF;
        IF TG_OP = 'UPDATE' AND OLD."status" = 'APPROVED' AND current_user = 'app_rw' THEN
            RAISE EXCEPTION 'approved time cannot be changed' USING ERRCODE = 'check_violation';
        END IF;
        PERFORM pg_advisory_xact_lock(hashtext(NEW."employee_id"::text || ':' || NEW."work_date"::text));
        SELECT coalesce(sum(t."minutes"), 0) INTO total
            FROM "time_entry" t
            WHERE t."employee_id" = NEW."employee_id" AND t."work_date" = NEW."work_date" AND t."id" <> NEW."id";
        IF total + NEW."minutes" > 1440 THEN
            RAISE EXCEPTION 'more than 24 hours in one day' USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
    END $$;

CREATE TRIGGER time_entry_check
    BEFORE INSERT OR UPDATE OR DELETE ON "time_entry"
    FOR EACH ROW EXECUTE FUNCTION time_entry_guard();
