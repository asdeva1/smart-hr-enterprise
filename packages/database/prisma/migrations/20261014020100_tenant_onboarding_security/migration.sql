-- Hand-written migration: who may create organisations and change their lifecycle and branding.

-- Organisations are created only by platform actors (the platform console, and completed self-service
-- sign-ups, which run as a system action after the email address is proven).
CREATE POLICY tenant_platform_insert ON "tenant"
    FOR INSERT
    WITH CHECK (app_is_platform_actor());

GRANT INSERT ON "tenant" TO app_rw;
-- Owners change their own branding; platform actors also change name, status and lifecycle dates.
GRANT UPDATE ("name", "status", "brand_name", "brand_color", "brand_logo_url", "offboarding_at", "archived_at")
    ON "tenant" TO app_rw;

-- Defence in depth: identity and lifecycle columns change only in a platform transaction, whatever the code
-- path. The existing tenant_self_update policy still confines every update to the tenant in context.
CREATE FUNCTION tenant_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
        IF (NEW."status" IS DISTINCT FROM OLD."status"
            OR NEW."slug" IS DISTINCT FROM OLD."slug"
            OR NEW."name" IS DISTINCT FROM OLD."name"
            OR NEW."offboarding_at" IS DISTINCT FROM OLD."offboarding_at"
            OR NEW."archived_at" IS DISTINCT FROM OLD."archived_at")
           AND NOT app_is_platform_actor()
           AND current_user = 'app_rw' THEN
            RAISE EXCEPTION 'tenant %: name, status and lifecycle are changed by platform operators only', OLD."id";
        END IF;
        RETURN NEW;
    END $$;

CREATE TRIGGER tenant_lifecycle_guard
    BEFORE UPDATE ON "tenant"
    FOR EACH ROW EXECUTE FUNCTION tenant_guard();

-- Sign-up requests exist before any organisation does, so no tenant policy fits. Only platform actors (the
-- sign-up service runs as one) can see or write them; any other transaction sees nothing.
ALTER TABLE "signup_request" ENABLE ROW LEVEL SECURITY;
CREATE POLICY signup_request_platform ON "signup_request"
    USING (app_is_platform_actor())
    WITH CHECK (app_is_platform_actor());
GRANT SELECT, INSERT, UPDATE ON "signup_request" TO app_rw;
