-- Hand-written migration: row-level security, grants and integrity rules for attendance.

ALTER TABLE "shift" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "shift"
    FOR ALL
    USING ("tenant_id" = app_current_tenant_id())
    WITH CHECK ("tenant_id" = app_current_tenant_id());

ALTER TABLE "shift_assignment" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "shift_assignment"
    FOR ALL
    USING ("tenant_id" = app_current_tenant_id())
    WITH CHECK ("tenant_id" = app_current_tenant_id());

ALTER TABLE "attendance_punch" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "attendance_punch"
    FOR ALL
    USING ("tenant_id" = app_current_tenant_id())
    WITH CHECK ("tenant_id" = app_current_tenant_id());

ALTER TABLE "attendance_day" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "attendance_day"
    FOR ALL
    USING ("tenant_id" = app_current_tenant_id())
    WITH CHECK ("tenant_id" = app_current_tenant_id());

ALTER TABLE "attendance_correction" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "attendance_correction"
    FOR ALL
    USING ("tenant_id" = app_current_tenant_id())
    WITH CHECK ("tenant_id" = app_current_tenant_id());

-- Shifts are archived, never deleted. Assignments are history: re-assigning the same start date may change
-- the shift, nothing else. Clock-ins are append-only. Days are a recomputable summary. Corrections change
-- status but are never deleted.
GRANT SELECT, INSERT, UPDATE ON "shift" TO app_rw;
GRANT SELECT, INSERT ON "shift_assignment" TO app_rw;
GRANT UPDATE ("shift_id") ON "shift_assignment" TO app_rw;
GRANT SELECT, INSERT ON "attendance_punch" TO app_rw;
GRANT SELECT, INSERT, UPDATE ON "attendance_day" TO app_rw;
GRANT SELECT, INSERT, UPDATE ON "attendance_correction" TO app_rw;

-- Shift times and thresholds must make sense, whatever wrote them.
CREATE FUNCTION shift_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
        IF NEW."start_minute" NOT BETWEEN 0 AND 1439 OR NEW."end_minute" NOT BETWEEN 0 AND 1439
           OR NEW."start_minute" = NEW."end_minute" THEN
            RAISE EXCEPTION 'shift %: start and end must be different times of day', NEW."code"
                USING ERRCODE = 'check_violation';
        END IF;
        IF NEW."break_minutes" < 0 OR NEW."grace_minutes" < 0 OR NEW."half_day_minutes" <= 0
           OR NEW."full_day_minutes" < NEW."half_day_minutes" THEN
            RAISE EXCEPTION 'shift %: thresholds are out of range', NEW."code" USING ERRCODE = 'check_violation';
        END IF;
        IF EXISTS (SELECT 1 FROM unnest(NEW."weekly_offs") AS d WHERE d NOT BETWEEN 0 AND 6) THEN
            RAISE EXCEPTION 'shift %: weekly offs are days 0 to 6', NEW."code" USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
    END $$;

CREATE TRIGGER shift_check
    BEFORE INSERT OR UPDATE ON "shift"
    FOR EACH ROW EXECUTE FUNCTION shift_guard();

-- A decided or withdrawn correction is final: it can't be reopened or edited.
CREATE FUNCTION attendance_correction_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
        IF OLD."status" IN ('APPROVED', 'REJECTED', 'CANCELLED') THEN
            RAISE EXCEPTION 'attendance correction %: already %', OLD."id", lower(OLD."status"::text)
                USING ERRCODE = 'check_violation';
        END IF;
        IF NEW."employee_id" IS DISTINCT FROM OLD."employee_id" OR NEW."date" IS DISTINCT FROM OLD."date" THEN
            RAISE EXCEPTION 'attendance correction %: employee and date are fixed', OLD."id"
                USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
    END $$;

CREATE TRIGGER attendance_correction_check
    BEFORE UPDATE ON "attendance_correction"
    FOR EACH ROW EXECUTE FUNCTION attendance_correction_guard();
