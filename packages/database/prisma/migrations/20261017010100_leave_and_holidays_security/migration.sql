-- Hand-written migration: row-level security, grants and integrity rules for holidays and leave.

ALTER TABLE "holiday_calendar" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "holiday_calendar"
    FOR ALL
    USING ("tenant_id" = app_current_tenant_id())
    WITH CHECK ("tenant_id" = app_current_tenant_id());

ALTER TABLE "holiday" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "holiday"
    FOR ALL
    USING ("tenant_id" = app_current_tenant_id())
    WITH CHECK ("tenant_id" = app_current_tenant_id());

ALTER TABLE "leave_type" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "leave_type"
    FOR ALL
    USING ("tenant_id" = app_current_tenant_id())
    WITH CHECK ("tenant_id" = app_current_tenant_id());

ALTER TABLE "leave_ledger_entry" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "leave_ledger_entry"
    FOR ALL
    USING ("tenant_id" = app_current_tenant_id())
    WITH CHECK ("tenant_id" = app_current_tenant_id());

ALTER TABLE "leave_request" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "leave_request"
    FOR ALL
    USING ("tenant_id" = app_current_tenant_id())
    WITH CHECK ("tenant_id" = app_current_tenant_id());

-- Calendars are renamed or archived, never moved or deleted. Holidays can be removed (a cancelled holiday).
-- Leave types are archived, never deleted. The ledger is append-only: a mistake is fixed by another entry.
-- Requests change status but are never deleted.
GRANT SELECT, INSERT ON "holiday_calendar" TO app_rw;
GRANT UPDATE ("name", "status", "updated_at") ON "holiday_calendar" TO app_rw;
GRANT SELECT, INSERT, DELETE ON "holiday" TO app_rw;
GRANT UPDATE ("name", "optional") ON "holiday" TO app_rw;
GRANT SELECT, INSERT, UPDATE ON "leave_type" TO app_rw;
GRANT SELECT, INSERT ON "leave_ledger_entry" TO app_rw;
GRANT SELECT, INSERT, UPDATE ON "leave_request" TO app_rw;

-- A calendar's place must match its scope key, so "one calendar per place" can't be sidestepped.
CREATE FUNCTION holiday_calendar_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
        IF NOT (
            (NEW."scope_key" = 'TENANT' AND NEW."company_id" IS NULL AND NEW."branch_id" IS NULL)
            OR (NEW."scope_key" = 'COMPANY:' || NEW."company_id" AND NEW."branch_id" IS NULL)
            OR (NEW."scope_key" = 'BRANCH:' || NEW."branch_id" AND NEW."company_id" IS NULL)
        ) THEN
            RAISE EXCEPTION 'holiday calendar %: scope key does not match its place', NEW."id"
                USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
    END $$;

CREATE TRIGGER holiday_calendar_check
    BEFORE INSERT OR UPDATE ON "holiday_calendar"
    FOR EACH ROW EXECUTE FUNCTION holiday_calendar_guard();

-- Leave amounts are whole or half days, and each kind of ledger entry moves the balance one way.
CREATE FUNCTION leave_ledger_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
        IF NEW."days" = 0 OR NEW."days" * 2 <> trunc(NEW."days" * 2) THEN
            RAISE EXCEPTION 'leave ledger: days must be a non-zero number of whole or half days'
                USING ERRCODE = 'check_violation';
        END IF;
        IF (NEW."kind" IN ('GRANT', 'ACCRUAL', 'CARRY_FORWARD', 'REVERSAL') AND NEW."days" < 0)
           OR (NEW."kind" IN ('TAKEN', 'LAPSE') AND NEW."days" > 0) THEN
            RAISE EXCEPTION 'leave ledger: % can''t be %', lower(NEW."kind"::text), NEW."days"
                USING ERRCODE = 'check_violation';
        END IF;
        IF NEW."kind" IN ('TAKEN', 'REVERSAL') AND NEW."request_id" IS NULL THEN
            RAISE EXCEPTION 'leave ledger: % needs the leave request', lower(NEW."kind"::text)
                USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
    END $$;

CREATE TRIGGER leave_ledger_check
    BEFORE INSERT ON "leave_ledger_entry"
    FOR EACH ROW EXECUTE FUNCTION leave_ledger_guard();

CREATE FUNCTION leave_type_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
        IF NEW."quota_days" < 0 OR NEW."carry_forward_max_days" < 0
           OR NEW."quota_days" * 2 <> trunc(NEW."quota_days" * 2)
           OR NEW."carry_forward_max_days" * 2 <> trunc(NEW."carry_forward_max_days" * 2)
           OR NEW."min_notice_days" < 0
           OR (NEW."max_days_per_request" IS NOT NULL AND NEW."max_days_per_request" < 1) THEN
            RAISE EXCEPTION 'leave type %: amounts are out of range', NEW."code" USING ERRCODE = 'check_violation';
        END IF;
        IF TG_OP = 'UPDATE' AND NEW."code" IS DISTINCT FROM OLD."code" THEN
            RAISE EXCEPTION 'leave type %: the code can''t change', OLD."code" USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
    END $$;

CREATE TRIGGER leave_type_check
    BEFORE INSERT OR UPDATE ON "leave_type"
    FOR EACH ROW EXECUTE FUNCTION leave_type_guard();

-- Dates in order, half days only for one-day requests, and a decision is final: rejected and cancelled
-- requests can't change again, and an approved request can only be cancelled.
CREATE FUNCTION leave_request_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
        IF NEW."to_date" < NEW."from_date" THEN
            RAISE EXCEPTION 'leave request: ends before it starts' USING ERRCODE = 'check_violation';
        END IF;
        IF NEW."half_day" IS NOT NULL AND NEW."to_date" <> NEW."from_date" THEN
            RAISE EXCEPTION 'leave request: a half day must be a single day' USING ERRCODE = 'check_violation';
        END IF;
        IF NEW."days" <= 0 OR NEW."days" * 2 <> trunc(NEW."days" * 2) THEN
            RAISE EXCEPTION 'leave request: days must be whole or half days' USING ERRCODE = 'check_violation';
        END IF;
        IF TG_OP = 'UPDATE' THEN
            IF OLD."status" IN ('REJECTED', 'CANCELLED') THEN
                RAISE EXCEPTION 'leave request %: already %', OLD."id", lower(OLD."status"::text)
                    USING ERRCODE = 'check_violation';
            END IF;
            IF OLD."status" = 'APPROVED' AND NEW."status" <> 'CANCELLED' THEN
                RAISE EXCEPTION 'leave request %: an approved request can only be cancelled', OLD."id"
                    USING ERRCODE = 'check_violation';
            END IF;
            IF NEW."employee_id" IS DISTINCT FROM OLD."employee_id"
               OR NEW."leave_type_id" IS DISTINCT FROM OLD."leave_type_id"
               OR NEW."from_date" IS DISTINCT FROM OLD."from_date"
               OR NEW."to_date" IS DISTINCT FROM OLD."to_date"
               OR NEW."half_day" IS DISTINCT FROM OLD."half_day"
               OR NEW."days" IS DISTINCT FROM OLD."days" THEN
                RAISE EXCEPTION 'leave request %: employee, type and dates are fixed', OLD."id"
                    USING ERRCODE = 'check_violation';
            END IF;
        END IF;
        RETURN NEW;
    END $$;

CREATE TRIGGER leave_request_check
    BEFORE INSERT OR UPDATE ON "leave_request"
    FOR EACH ROW EXECUTE FUNCTION leave_request_guard();
