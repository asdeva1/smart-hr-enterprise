-- Hand-written migration: row-level security, grants and worker functions for notifications and approvals.

-- ---------------------------------------------------------------------------------------------------------
-- Notifications: anyone in the organisation's context can create one (the approval engine notifies others);
-- only the recipient can read it or mark it read.
-- ---------------------------------------------------------------------------------------------------------
ALTER TABLE "notification" ENABLE ROW LEVEL SECURITY;

CREATE POLICY notification_insert ON "notification"
    FOR INSERT
    WITH CHECK ("tenant_id" = app_current_tenant_id());

CREATE POLICY notification_recipient_read ON "notification"
    FOR SELECT
    USING ("tenant_id" = app_current_tenant_id() AND "recipient_user_id" = app_current_user_id());

CREATE POLICY notification_recipient_update ON "notification"
    FOR UPDATE
    USING ("tenant_id" = app_current_tenant_id() AND "recipient_user_id" = app_current_user_id())
    WITH CHECK ("tenant_id" = app_current_tenant_id() AND "recipient_user_id" = app_current_user_id());

GRANT SELECT, INSERT ON "notification" TO app_rw;
-- Recipients may only mark notifications read; delivery columns are changed by the functions below.
GRANT UPDATE ("read_at") ON "notification" TO app_rw;

ALTER TABLE "notification_preference" ENABLE ROW LEVEL SECURITY;

-- Readable within the organisation (the engine checks a recipient's preference when someone else acts);
-- each person changes only their own.
CREATE POLICY preference_read ON "notification_preference"
    FOR SELECT
    USING ("tenant_id" = app_current_tenant_id());

CREATE POLICY preference_own_insert ON "notification_preference"
    FOR INSERT
    WITH CHECK ("tenant_id" = app_current_tenant_id() AND "user_id" = app_current_user_id());

CREATE POLICY preference_own_update ON "notification_preference"
    FOR UPDATE
    USING ("tenant_id" = app_current_tenant_id() AND "user_id" = app_current_user_id())
    WITH CHECK ("tenant_id" = app_current_tenant_id() AND "user_id" = app_current_user_id());

CREATE POLICY preference_own_delete ON "notification_preference"
    FOR DELETE
    USING ("tenant_id" = app_current_tenant_id() AND "user_id" = app_current_user_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON "notification_preference" TO app_rw;

-- ---------------------------------------------------------------------------------------------------------
-- Email outbox. The notification row is written in the same transaction as the event that causes it; the
-- worker claims PENDING rows here and reports the outcome. These run as the table owner (bypassing RLS
-- across tenants) but expose only what delivery needs.
-- ---------------------------------------------------------------------------------------------------------
CREATE FUNCTION claim_email_notifications(p_limit integer, p_reclaim_after_seconds integer)
    RETURNS TABLE (id uuid, category text, email_to text, email_subject text, email_text text)
    LANGUAGE sql
    SECURITY DEFINER
    SET search_path = public
    AS $$
        UPDATE "notification" n
        SET "email_claimed_at" = now(), "email_attempts" = n."email_attempts" + 1
        WHERE n."id" IN (
            SELECT c."id" FROM "notification" c
            WHERE c."email_status" = 'PENDING'
              AND (c."email_claimed_at" IS NULL
                   OR c."email_claimed_at" < now() - make_interval(secs => p_reclaim_after_seconds))
            ORDER BY c."created_at"
            LIMIT least(p_limit, 200)
            FOR UPDATE SKIP LOCKED
        )
        RETURNING n."id", n."category", n."email_to", n."email_subject", n."email_text"
    $$;

CREATE FUNCTION complete_email_notification(p_id uuid, p_sent boolean, p_error text, p_max_attempts integer)
    RETURNS void
    LANGUAGE sql
    SECURITY DEFINER
    SET search_path = public
    AS $$
        UPDATE "notification"
        SET "email_status" = CASE
                WHEN p_sent THEN 'SENT'::email_delivery_status
                WHEN "email_attempts" >= p_max_attempts THEN 'FAILED'::email_delivery_status
                ELSE 'PENDING'::email_delivery_status
            END,
            "email_sent_at" = CASE WHEN p_sent THEN now() ELSE NULL END,
            "email_last_error" = CASE WHEN p_sent THEN NULL ELSE left(p_error, 500) END,
            -- Sent rows drop their content: it is no longer needed and may contain personal data.
            "email_text" = CASE WHEN p_sent THEN NULL ELSE "email_text" END
        WHERE "id" = p_id AND "email_status" = 'PENDING'
    $$;

-- ---------------------------------------------------------------------------------------------------------
-- Approvals: standard tenant isolation. Nothing is deleted; history stays.
-- ---------------------------------------------------------------------------------------------------------
ALTER TABLE "approval_policy" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "approval_policy"
    FOR ALL
    USING ("tenant_id" = app_current_tenant_id())
    WITH CHECK ("tenant_id" = app_current_tenant_id());

ALTER TABLE "approval_request" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "approval_request"
    FOR ALL
    USING ("tenant_id" = app_current_tenant_id())
    WITH CHECK ("tenant_id" = app_current_tenant_id());

ALTER TABLE "approval_task" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "approval_task"
    FOR ALL
    USING ("tenant_id" = app_current_tenant_id())
    WITH CHECK ("tenant_id" = app_current_tenant_id());

ALTER TABLE "approval_delegation" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "approval_delegation"
    FOR ALL
    USING ("tenant_id" = app_current_tenant_id())
    WITH CHECK ("tenant_id" = app_current_tenant_id());

GRANT SELECT, INSERT ON "approval_policy" TO app_rw;
GRANT UPDATE ("is_active") ON "approval_policy" TO app_rw;
GRANT SELECT, INSERT, UPDATE ON "approval_request", "approval_task", "approval_delegation" TO app_rw;

-- Overdue tasks across all tenants: marks them escalated (once) and returns what the worker needs to notify,
-- per tenant, through the normal tenant-scoped path.
CREATE FUNCTION claim_overdue_approval_tasks(p_limit integer)
    RETURNS TABLE (task_id uuid, tenant_id uuid, request_id uuid, assignee_membership_id uuid)
    LANGUAGE sql
    SECURITY DEFINER
    SET search_path = public
    AS $$
        UPDATE "approval_task" t
        SET "escalated_at" = now()
        WHERE t."id" IN (
            SELECT o."id" FROM "approval_task" o
            WHERE o."status" = 'PENDING' AND o."due_at" < now() AND o."escalated_at" IS NULL
            ORDER BY o."due_at"
            LIMIT least(p_limit, 200)
            FOR UPDATE SKIP LOCKED
        )
        RETURNING t."id", t."tenant_id", t."request_id", t."assignee_membership_id"
    $$;

REVOKE ALL ON FUNCTION claim_email_notifications(integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION complete_email_notification(uuid, boolean, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION claim_overdue_approval_tasks(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_email_notifications(integer, integer) TO app_rw;
GRANT EXECUTE ON FUNCTION complete_email_notification(uuid, boolean, text, integer) TO app_rw;
GRANT EXECUTE ON FUNCTION claim_overdue_approval_tasks(integer) TO app_rw;
