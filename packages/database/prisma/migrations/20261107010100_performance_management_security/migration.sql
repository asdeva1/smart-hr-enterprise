-- Hand-written migration: row-level security, grants and integrity rules for performance management.

ALTER TABLE "review_cycle" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "review_cycle" FOR ALL
    USING ("tenant_id" = app_current_tenant_id()) WITH CHECK ("tenant_id" = app_current_tenant_id());
ALTER TABLE "performance_goal" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "performance_goal" FOR ALL
    USING ("tenant_id" = app_current_tenant_id()) WITH CHECK ("tenant_id" = app_current_tenant_id());
ALTER TABLE "appraisal" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "appraisal" FOR ALL
    USING ("tenant_id" = app_current_tenant_id()) WITH CHECK ("tenant_id" = app_current_tenant_id());
ALTER TABLE "feedback_note" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "feedback_note" FOR ALL
    USING ("tenant_id" = app_current_tenant_id()) WITH CHECK ("tenant_id" = app_current_tenant_id());

-- Cycles and appraisals are never deleted; feedback is never edited or deleted.
GRANT SELECT, INSERT, UPDATE ON "review_cycle" TO app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON "performance_goal" TO app_rw;
GRANT SELECT, INSERT, UPDATE ON "appraisal" TO app_rw;
GRANT SELECT, INSERT ON "feedback_note" TO app_rw;

ALTER TABLE "review_cycle" ADD CONSTRAINT "review_cycle_period_check" CHECK ("period_to" >= "period_from");
ALTER TABLE "review_cycle" ADD CONSTRAINT "review_cycle_name_check" CHECK (length(btrim("name")) > 0);
ALTER TABLE "performance_goal" ADD CONSTRAINT "performance_goal_weight_check" CHECK ("weight" BETWEEN 1 AND 100);
ALTER TABLE "performance_goal" ADD CONSTRAINT "performance_goal_progress_check" CHECK ("progress" BETWEEN 0 AND 100);
ALTER TABLE "appraisal" ADD CONSTRAINT "appraisal_ratings_check" CHECK (
    ("self_rating" IS NULL OR "self_rating" BETWEEN 1 AND 5) AND
    ("manager_rating" IS NULL OR "manager_rating" BETWEEN 1 AND 5));
-- Each step of the review leaves its mark, and the next step cannot happen without the one before.
ALTER TABLE "appraisal" ADD CONSTRAINT "appraisal_state_check" CHECK (
    CASE "status"
        WHEN 'AWAITING_SELF' THEN "self_rating" IS NULL AND "manager_rating" IS NULL
        WHEN 'AWAITING_MANAGER' THEN "self_rating" IS NOT NULL AND "self_submitted_at" IS NOT NULL AND "manager_rating" IS NULL
        WHEN 'COMPLETED' THEN "self_rating" IS NOT NULL AND "manager_rating" IS NOT NULL AND "completed_at" IS NOT NULL AND "acknowledged_at" IS NULL
        WHEN 'ACKNOWLEDGED' THEN "self_rating" IS NOT NULL AND "manager_rating" IS NOT NULL AND "completed_at" IS NOT NULL AND "acknowledged_at" IS NOT NULL
    END);
ALTER TABLE "feedback_note" ADD CONSTRAINT "feedback_note_not_self" CHECK ("from_id" <> "to_id");
ALTER TABLE "feedback_note" ADD CONSTRAINT "feedback_note_message_check" CHECK (length(btrim("message")) BETWEEN 1 AND 2000);

-- A cycle moves forward only: draft, open, closed.
CREATE FUNCTION review_cycle_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW."status" <> OLD."status" AND NOT (
        (OLD."status" = 'DRAFT' AND NEW."status" = 'OPEN') OR (OLD."status" = 'OPEN' AND NEW."status" = 'CLOSED')
    ) THEN
        RAISE EXCEPTION 'a review cycle cannot go from % to %', OLD."status", NEW."status" USING ERRCODE = '23514';
    END IF;
    IF OLD."status" = 'CLOSED' AND (NEW."name" <> OLD."name" OR NEW."period_from" <> OLD."period_from" OR NEW."period_to" <> OLD."period_to") THEN
        RAISE EXCEPTION 'a closed review cycle cannot be changed' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER review_cycle_transition BEFORE UPDATE ON "review_cycle"
    FOR EACH ROW EXECUTE FUNCTION review_cycle_guard();

-- Goals and appraisals of a closed cycle are frozen, and one person's active goal weights never pass 100.
CREATE FUNCTION performance_goal_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    cycle_status "review_cycle_status";
    total INTEGER;
BEGIN
    SELECT "status" INTO cycle_status FROM "review_cycle" WHERE "id" = NEW."cycle_id" AND "tenant_id" = NEW."tenant_id";
    IF cycle_status = 'CLOSED' THEN
        RAISE EXCEPTION 'the review cycle is closed' USING ERRCODE = '23514';
    END IF;
    IF NEW."status" <> 'DROPPED' THEN
        PERFORM pg_advisory_xact_lock(hashtext(NEW."employee_id"::text || NEW."cycle_id"::text));
        SELECT coalesce(sum("weight"), 0) INTO total FROM "performance_goal"
         WHERE "tenant_id" = NEW."tenant_id" AND "cycle_id" = NEW."cycle_id" AND "employee_id" = NEW."employee_id"
           AND "status" <> 'DROPPED' AND "id" <> NEW."id";
        IF total + NEW."weight" > 100 THEN
            RAISE EXCEPTION 'goal weights add up to more than 100' USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER performance_goal_check BEFORE INSERT OR UPDATE ON "performance_goal"
    FOR EACH ROW EXECUTE FUNCTION performance_goal_guard();

CREATE FUNCTION appraisal_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    cycle_status "review_cycle_status";
BEGIN
    SELECT "status" INTO cycle_status FROM "review_cycle" WHERE "id" = NEW."cycle_id" AND "tenant_id" = NEW."tenant_id";
    IF TG_OP = 'INSERT' THEN
        IF cycle_status <> 'OPEN' THEN
            RAISE EXCEPTION 'appraisals are only created when a cycle opens' USING ERRCODE = '23514';
        END IF;
    ELSIF NEW."status" <> OLD."status" OR NEW."self_rating" IS DISTINCT FROM OLD."self_rating"
          OR NEW."manager_rating" IS DISTINCT FROM OLD."manager_rating" THEN
        IF cycle_status = 'CLOSED' AND NOT (OLD."status" = 'COMPLETED' AND NEW."status" = 'ACKNOWLEDGED') THEN
            RAISE EXCEPTION 'the review cycle is closed' USING ERRCODE = '23514';
        END IF;
        IF NOT (
            (OLD."status" = 'AWAITING_SELF' AND NEW."status" = 'AWAITING_MANAGER') OR
            (OLD."status" = 'AWAITING_MANAGER' AND NEW."status" = 'COMPLETED') OR
            (OLD."status" = 'COMPLETED' AND NEW."status" = 'ACKNOWLEDGED')
        ) THEN
            RAISE EXCEPTION 'an appraisal cannot go from % to %', OLD."status", NEW."status" USING ERRCODE = '23514';
        END IF;
        IF OLD."status" IN ('COMPLETED', 'ACKNOWLEDGED') AND (NEW."manager_rating" IS DISTINCT FROM OLD."manager_rating" OR NEW."self_rating" IS DISTINCT FROM OLD."self_rating") THEN
            RAISE EXCEPTION 'a completed appraisal cannot be rated again' USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER appraisal_check BEFORE INSERT OR UPDATE ON "appraisal"
    FOR EACH ROW EXECUTE FUNCTION appraisal_guard();
