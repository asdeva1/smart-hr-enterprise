-- Hand-written migration: row-level security, grants and integrity rules for recruitment and onboarding.

ALTER TABLE "job_opening" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "job_opening"
    FOR ALL
    USING ("tenant_id" = app_current_tenant_id())
    WITH CHECK ("tenant_id" = app_current_tenant_id());

ALTER TABLE "candidate" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "candidate"
    FOR ALL
    USING ("tenant_id" = app_current_tenant_id())
    WITH CHECK ("tenant_id" = app_current_tenant_id());

ALTER TABLE "job_application" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "job_application"
    FOR ALL
    USING ("tenant_id" = app_current_tenant_id())
    WITH CHECK ("tenant_id" = app_current_tenant_id());

ALTER TABLE "application_event" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "application_event"
    FOR ALL
    USING ("tenant_id" = app_current_tenant_id())
    WITH CHECK ("tenant_id" = app_current_tenant_id());

ALTER TABLE "interview" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "interview"
    FOR ALL
    USING ("tenant_id" = app_current_tenant_id())
    WITH CHECK ("tenant_id" = app_current_tenant_id());

ALTER TABLE "interview_feedback" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "interview_feedback"
    FOR ALL
    USING ("tenant_id" = app_current_tenant_id())
    WITH CHECK ("tenant_id" = app_current_tenant_id());

ALTER TABLE "job_offer" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "job_offer"
    FOR ALL
    USING ("tenant_id" = app_current_tenant_id())
    WITH CHECK ("tenant_id" = app_current_tenant_id());

ALTER TABLE "onboarding_template" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "onboarding_template"
    FOR ALL
    USING ("tenant_id" = app_current_tenant_id())
    WITH CHECK ("tenant_id" = app_current_tenant_id());

ALTER TABLE "onboarding_template_task" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "onboarding_template_task"
    FOR ALL
    USING ("tenant_id" = app_current_tenant_id())
    WITH CHECK ("tenant_id" = app_current_tenant_id());

ALTER TABLE "onboarding_plan" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "onboarding_plan"
    FOR ALL
    USING ("tenant_id" = app_current_tenant_id())
    WITH CHECK ("tenant_id" = app_current_tenant_id());

ALTER TABLE "onboarding_task" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "onboarding_task"
    FOR ALL
    USING ("tenant_id" = app_current_tenant_id())
    WITH CHECK ("tenant_id" = app_current_tenant_id());

-- An opening's company and code never change.
GRANT SELECT, INSERT ON "job_opening" TO app_rw;
GRANT UPDATE ("title", "branch_id", "department_id", "designation_id", "employment_type_id", "hiring_manager_id",
              "positions", "description", "status", "approval_request_id", "opened_at", "closed_at", "updated_at")
    ON "job_opening" TO app_rw;

-- A candidate's email is how they are recognised; it doesn't change.
GRANT SELECT, INSERT ON "candidate" TO app_rw;
GRANT UPDATE ("first_name", "last_name", "phone", "source", "resume_file_id", "notes", "updated_at")
    ON "candidate" TO app_rw;

GRANT SELECT, INSERT ON "job_application" TO app_rw;
GRANT UPDATE ("stage", "closed_reason", "hired_employee_id", "updated_at") ON "job_application" TO app_rw;

-- Stage history is append-only.
GRANT SELECT, INSERT ON "application_event" TO app_rw;

GRANT SELECT, INSERT ON "interview" TO app_rw;
GRANT UPDATE ("title", "scheduled_at", "duration_minutes", "location", "status", "updated_at") ON "interview" TO app_rw;

GRANT SELECT, INSERT ON "interview_feedback" TO app_rw;
GRANT UPDATE ("rating", "recommendation", "comments", "submitted_at", "updated_at") ON "interview_feedback" TO app_rw;

-- What was offered can't be rewritten after it is sent for approval.
GRANT SELECT, INSERT ON "job_offer" TO app_rw;
GRANT UPDATE ("status", "approval_request_id", "decision_note", "decided_at", "responded_at", "updated_at")
    ON "job_offer" TO app_rw;

GRANT SELECT, INSERT, UPDATE ON "onboarding_template" TO app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON "onboarding_template_task" TO app_rw;

GRANT SELECT, INSERT ON "onboarding_plan" TO app_rw;
GRANT UPDATE ("status", "completed_at", "updated_at") ON "onboarding_plan" TO app_rw;

GRANT SELECT, INSERT ON "onboarding_task" TO app_rw;
GRANT UPDATE ("status", "completed_at", "completed_by_user_id", "note", "assignee_user_id", "due_date", "updated_at")
    ON "onboarding_task" TO app_rw;

-- A hired, rejected or withdrawn application is closed; the employee it became never changes.
CREATE FUNCTION job_application_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
        IF OLD."stage" IN ('HIRED', 'REJECTED', 'WITHDRAWN') AND NEW IS DISTINCT FROM OLD THEN
            RAISE EXCEPTION 'application %: already %', OLD."id", lower(OLD."stage"::text)
                USING ERRCODE = 'check_violation';
        END IF;
        IF NEW."stage" = 'HIRED' AND NEW."hired_employee_id" IS NULL THEN
            RAISE EXCEPTION 'application %: hired without an employee record', OLD."id"
                USING ERRCODE = 'check_violation';
        END IF;
        IF NEW."hired_employee_id" IS NOT NULL AND NEW."stage" <> 'HIRED' THEN
            RAISE EXCEPTION 'application %: only a hire has an employee record', OLD."id"
                USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
    END $$;

CREATE TRIGGER job_application_check
    BEFORE UPDATE ON "job_application"
    FOR EACH ROW EXECUTE FUNCTION job_application_guard();

-- Submitted interview feedback is final.
CREATE FUNCTION interview_feedback_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
        IF OLD."submitted_at" IS NOT NULL THEN
            RAISE EXCEPTION 'interview feedback %: already submitted', OLD."id" USING ERRCODE = 'check_violation';
        END IF;
        IF NEW."submitted_at" IS NOT NULL AND (NEW."recommendation" IS NULL OR NEW."rating" IS NULL) THEN
            RAISE EXCEPTION 'interview feedback %: submitted without a rating and recommendation', OLD."id"
                USING ERRCODE = 'check_violation';
        END IF;
        IF NEW."rating" IS NOT NULL AND (NEW."rating" < 1 OR NEW."rating" > 5) THEN
            RAISE EXCEPTION 'interview feedback %: rating must be 1 to 5', OLD."id" USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
    END $$;

CREATE TRIGGER interview_feedback_check
    BEFORE UPDATE ON "interview_feedback"
    FOR EACH ROW EXECUTE FUNCTION interview_feedback_guard();

-- Offers move forward only: approval, then the candidate's answer. Closed offers are final.
CREATE FUNCTION job_offer_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
        IF NEW."status" = OLD."status" THEN
            RETURN NEW;
        END IF;
        IF OLD."status" IN ('REJECTED', 'CANCELLED', 'ACCEPTED', 'DECLINED') THEN
            RAISE EXCEPTION 'offer %: already %', OLD."id", lower(OLD."status"::text)
                USING ERRCODE = 'check_violation';
        END IF;
        IF NEW."status" IN ('ACCEPTED', 'DECLINED') AND OLD."status" <> 'APPROVED' THEN
            RAISE EXCEPTION 'offer %: only an approved offer can be accepted or declined', OLD."id"
                USING ERRCODE = 'check_violation';
        END IF;
        IF OLD."status" = 'APPROVED' AND NEW."status" NOT IN ('ACCEPTED', 'DECLINED', 'CANCELLED') THEN
            RAISE EXCEPTION 'offer %: an approved offer can only be accepted, declined or withdrawn', OLD."id"
                USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
    END $$;

CREATE TRIGGER job_offer_check
    BEFORE UPDATE ON "job_offer"
    FOR EACH ROW EXECUTE FUNCTION job_offer_guard();
