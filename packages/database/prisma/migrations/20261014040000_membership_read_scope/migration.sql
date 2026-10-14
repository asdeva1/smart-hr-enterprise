-- Hand-written migration: a member's own memberships in OTHER organisations are visible only while no
-- organisation is in context (the organisation picker at sign-in).
--
-- Before this, a transaction scoped to organisation A could also see the current user's memberships in
-- organisations B and C. Nothing belonging to other people was exposed, but queries that relied on RLS alone
-- (member lists, owner counts, the members limit) included the user's rows from other organisations.

ALTER POLICY membership_read ON "tenant_membership"
    USING (
        "tenant_id" = app_current_tenant_id()
        OR (app_current_tenant_id() IS NULL AND "user_id" = app_current_user_id())
    );

ALTER POLICY tenant_member_read ON "tenant"
    USING (
        app_current_tenant_id() IS NULL
        AND EXISTS (
            SELECT 1 FROM "tenant_membership" m
            WHERE m."tenant_id" = "tenant"."id" AND m."user_id" = app_current_user_id()
        )
    );
