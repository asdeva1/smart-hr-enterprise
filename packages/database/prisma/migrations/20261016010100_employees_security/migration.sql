-- Hand-written migration: row-level security, grants and integrity rules for employee records.

ALTER TABLE "employee" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "employee"
    FOR ALL
    USING ("tenant_id" = app_current_tenant_id())
    WITH CHECK ("tenant_id" = app_current_tenant_id());

ALTER TABLE "employee_sensitive" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "employee_sensitive"
    FOR ALL
    USING ("tenant_id" = app_current_tenant_id())
    WITH CHECK ("tenant_id" = app_current_tenant_id());

ALTER TABLE "employee_event" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "employee_event"
    FOR ALL
    USING ("tenant_id" = app_current_tenant_id())
    WITH CHECK ("tenant_id" = app_current_tenant_id());

ALTER TABLE "emergency_contact" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "emergency_contact"
    FOR ALL
    USING ("tenant_id" = app_current_tenant_id())
    WITH CHECK ("tenant_id" = app_current_tenant_id());

ALTER TABLE "employee_counter" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "employee_counter"
    FOR ALL
    USING ("tenant_id" = app_current_tenant_id())
    WITH CHECK ("tenant_id" = app_current_tenant_id());

-- Employees are never deleted (exits keep the record); history is append-only; contacts can be removed.
GRANT SELECT, INSERT, UPDATE ON "employee", "employee_sensitive", "employee_counter" TO app_rw;
GRANT SELECT, INSERT ON "employee_event" TO app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON "emergency_contact" TO app_rw;

-- A lookup reference must point at a value from the right list (a grade can't be stored as a designation),
-- and nobody manages themself.
CREATE FUNCTION employee_lookup_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    DECLARE
        checks CONSTANT text[][] := ARRAY[
            ARRAY['designation_id', 'designation'],
            ARRAY['grade_id', 'grade'],
            ARRAY['employment_type_id', 'employment_type'],
            ARRAY['cost_centre_id', 'cost_centre'],
            ARRAY['exit_reason_id', 'exit_reason']];
        pair text[];
        ref uuid;
        found_list text;
    BEGIN
        -- A manager can't be the employee themself (longer cycles are refused by the API, which walks the chain).
        IF NEW."manager_id" = NEW."id" THEN
            RAISE EXCEPTION 'employee %: cannot be their own manager', NEW."id" USING ERRCODE = 'check_violation';
        END IF;
        FOREACH pair SLICE 1 IN ARRAY checks LOOP
            EXECUTE format('SELECT ($1).%I', pair[1]) INTO ref USING NEW;
            IF ref IS NOT NULL THEN
                SELECT "list" INTO found_list FROM "lookup_value" WHERE "tenant_id" = NEW."tenant_id" AND "id" = ref;
                IF found_list IS DISTINCT FROM pair[2] THEN
                    RAISE EXCEPTION 'employee %: % must reference a % value', NEW."id", pair[1], pair[2]
                        USING ERRCODE = 'check_violation';
                END IF;
            END IF;
        END LOOP;
        RETURN NEW;
    END $$;

CREATE TRIGGER employee_lookup_check
    BEFORE INSERT OR UPDATE ON "employee"
    FOR EACH ROW EXECUTE FUNCTION employee_lookup_guard();

