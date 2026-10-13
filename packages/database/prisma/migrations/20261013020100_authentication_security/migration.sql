-- Hand-written migration: access rules for the authentication tables.
--
-- app_user, user_session, password_reset_token and mfa_recovery_code are identity tables, not tenant data.
-- They are read before any tenant is chosen (sign-in looks a user up by email), so they carry no tenant RLS;
-- only the API's auth module touches them.
--
-- tenant_membership and audit_event do carry tenant data and get row-level security below.

-- The signed-in user, set per transaction alongside app.tenant_id.
CREATE FUNCTION app_current_user_id() RETURNS uuid
    LANGUAGE sql STABLE
    AS $$ SELECT NULLIF(current_setting('app.user_id', true), '')::uuid $$;

-- tenant_membership: visible inside its tenant, and to the member themself (to list "my tenants" at sign-in).
ALTER TABLE "tenant_membership" ENABLE ROW LEVEL SECURITY;

CREATE POLICY membership_read ON "tenant_membership"
    FOR SELECT
    USING ("tenant_id" = app_current_tenant_id() OR "user_id" = app_current_user_id());

CREATE POLICY membership_write ON "tenant_membership"
    FOR ALL
    USING ("tenant_id" = app_current_tenant_id())
    WITH CHECK ("tenant_id" = app_current_tenant_id());

-- tenant: additionally readable for tenants the current user belongs to (names on the tenant picker).
CREATE POLICY tenant_member_read ON "tenant"
    FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM "tenant_membership" m
        WHERE m."tenant_id" = "tenant"."id" AND m."user_id" = app_current_user_id()
    ));

-- audit_event: append-only.
ALTER TABLE "audit_event" ENABLE ROW LEVEL SECURITY;

-- Writes: a tenant event only inside that tenant; a platform event (tenant_id null) from anywhere.
CREATE POLICY audit_insert ON "audit_event"
    FOR INSERT
    WITH CHECK ("tenant_id" IS NULL OR "tenant_id" = app_current_tenant_id());

-- Reads: a tenant's events inside that tenant; a user's own platform-level events (their sign-in history).
CREATE POLICY audit_read ON "audit_event"
    FOR SELECT
    USING (
        "tenant_id" = app_current_tenant_id()
        OR ("tenant_id" IS NULL AND "actor_user_id" = app_current_user_id())
    );

-- Defence in depth: refuse UPDATE and DELETE for every role, including the owner.
CREATE FUNCTION audit_event_immutable() RETURNS trigger
    LANGUAGE plpgsql
    AS $$ BEGIN RAISE EXCEPTION 'audit_event is append-only'; END $$;

CREATE TRIGGER audit_event_no_update_delete
    BEFORE UPDATE OR DELETE ON "audit_event"
    FOR EACH ROW EXECUTE FUNCTION audit_event_immutable();

-- Runtime role privileges.
GRANT EXECUTE ON FUNCTION app_current_user_id() TO app_rw;
GRANT SELECT, INSERT, UPDATE ON "app_user" TO app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON "user_session" TO app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON "password_reset_token" TO app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON "mfa_recovery_code" TO app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON "tenant_membership" TO app_rw;
GRANT SELECT, INSERT ON "audit_event" TO app_rw;
