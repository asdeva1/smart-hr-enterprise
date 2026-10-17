-- Hand-written migration: row-level security, grants and integrity rules for employment change requests.

ALTER TABLE "employee_change_request" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "employee_change_request"
    FOR ALL
    USING ("tenant_id" = app_current_tenant_id())
    WITH CHECK ("tenant_id" = app_current_tenant_id());

-- Requests change status but are never deleted, and what was asked for can't be rewritten afterwards.
GRANT SELECT, INSERT ON "employee_change_request" TO app_rw;
GRANT UPDATE ("status", "approval_request_id", "decision_note", "decided_at", "updated_at")
    ON "employee_change_request" TO app_rw;

-- A decided or withdrawn request is final.
CREATE FUNCTION employee_change_request_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
        IF OLD."status" IN ('APPROVED', 'REJECTED', 'CANCELLED') THEN
            RAISE EXCEPTION 'employment change %: already %', OLD."id", lower(OLD."status"::text)
                USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
    END $$;

CREATE TRIGGER employee_change_request_check
    BEFORE UPDATE ON "employee_change_request"
    FOR EACH ROW EXECUTE FUNCTION employee_change_request_guard();
