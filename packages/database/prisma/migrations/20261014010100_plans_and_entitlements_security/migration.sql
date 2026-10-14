-- Hand-written migration: access rules for plans, subscriptions and entitlements.

-- ---------------------------------------------------------------------------------------------------------
-- Platform-operator context. Set per transaction by the API's platform console (after checking that the
-- signed-in user is a platform administrator) and by the worker's subscription sweep. Tenant code paths never
-- set it, so even a bug there cannot change what an organisation has paid for.
-- ---------------------------------------------------------------------------------------------------------
CREATE FUNCTION app_is_platform_actor() RETURNS boolean
    LANGUAGE sql STABLE
    AS $$ SELECT coalesce(current_setting('app.platform_actor', true), '') = 'on' $$;

GRANT EXECUTE ON FUNCTION app_is_platform_actor() TO app_rw;

-- ---------------------------------------------------------------------------------------------------------
-- Catalogue: global, readable by every code path (the entitlement resolver needs it in every tenant).
-- Published plan versions and their prices are frozen.
-- ---------------------------------------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON "plan", "addon" TO app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON "plan_version", "plan_price", "addon_price" TO app_rw;

CREATE FUNCTION plan_version_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
        IF TG_OP = 'DELETE' THEN
            IF OLD."status" <> 'DRAFT' THEN
                RAISE EXCEPTION 'plan_version %: only drafts can be deleted', OLD."id";
            END IF;
            RETURN OLD;
        END IF;
        IF OLD."status" <> 'DRAFT' THEN
            -- Published and retired versions may only move forward in status; their contents never change.
            IF NEW."features" IS DISTINCT FROM OLD."features"
               OR NEW."limits" IS DISTINCT FROM OLD."limits"
               OR NEW."trial_days" IS DISTINCT FROM OLD."trial_days"
               OR NEW."grace_days" IS DISTINCT FROM OLD."grace_days"
               OR NEW."support_level" IS DISTINCT FROM OLD."support_level"
               OR NEW."deployment_models" IS DISTINCT FROM OLD."deployment_models"
               OR NEW."plan_id" IS DISTINCT FROM OLD."plan_id"
               OR NEW."version" IS DISTINCT FROM OLD."version"
               OR NEW."published_at" IS DISTINCT FROM OLD."published_at" THEN
                RAISE EXCEPTION 'plan_version %: a published version cannot be changed', OLD."id";
            END IF;
            IF NOT (OLD."status" = NEW."status" OR (OLD."status" = 'PUBLISHED' AND NEW."status" = 'RETIRED')) THEN
                RAISE EXCEPTION 'plan_version %: status cannot go from % to %', OLD."id", OLD."status", NEW."status";
            END IF;
        END IF;
        RETURN NEW;
    END $$;

CREATE TRIGGER plan_version_frozen
    BEFORE UPDATE OR DELETE ON "plan_version"
    FOR EACH ROW EXECUTE FUNCTION plan_version_guard();

CREATE FUNCTION plan_price_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    DECLARE
        v_status plan_version_status;
    BEGIN
        SELECT "status" INTO v_status FROM "plan_version"
            WHERE "id" = (CASE WHEN TG_OP = 'INSERT' THEN NEW."plan_version_id" ELSE OLD."plan_version_id" END);
        -- No parent row means the draft version itself is being deleted (published ones cannot be).
        IF v_status IS NOT NULL AND v_status <> 'DRAFT' THEN
            RAISE EXCEPTION 'plan_price: prices of a published plan version cannot be changed';
        END IF;
        IF TG_OP = 'UPDATE' AND NEW."plan_version_id" IS DISTINCT FROM OLD."plan_version_id" THEN
            RAISE EXCEPTION 'plan_price: a price cannot move to another version';
        END IF;
        RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END $$;

CREATE TRIGGER plan_price_frozen
    BEFORE INSERT OR UPDATE OR DELETE ON "plan_price"
    FOR EACH ROW EXECUTE FUNCTION plan_price_guard();

-- ---------------------------------------------------------------------------------------------------------
-- Subscriptions: an organisation can read its own; only a platform actor can write, and still only inside
-- the tenant whose context is set.
-- ---------------------------------------------------------------------------------------------------------
ALTER TABLE "subscription" ENABLE ROW LEVEL SECURITY;
CREATE POLICY subscription_read ON "subscription"
    FOR SELECT
    USING ("tenant_id" = app_current_tenant_id());
CREATE POLICY subscription_platform_insert ON "subscription"
    FOR INSERT
    WITH CHECK ("tenant_id" = app_current_tenant_id() AND app_is_platform_actor());
CREATE POLICY subscription_platform_update ON "subscription"
    FOR UPDATE
    USING ("tenant_id" = app_current_tenant_id() AND app_is_platform_actor())
    WITH CHECK ("tenant_id" = app_current_tenant_id() AND app_is_platform_actor());

ALTER TABLE "subscription_addon" ENABLE ROW LEVEL SECURITY;
CREATE POLICY subscription_addon_read ON "subscription_addon"
    FOR SELECT
    USING ("tenant_id" = app_current_tenant_id());
CREATE POLICY subscription_addon_platform_write ON "subscription_addon"
    FOR ALL
    USING ("tenant_id" = app_current_tenant_id() AND app_is_platform_actor())
    WITH CHECK ("tenant_id" = app_current_tenant_id() AND app_is_platform_actor());

ALTER TABLE "entitlement_override" ENABLE ROW LEVEL SECURITY;
CREATE POLICY entitlement_override_read ON "entitlement_override"
    FOR SELECT
    USING ("tenant_id" = app_current_tenant_id());
CREATE POLICY entitlement_override_platform_insert ON "entitlement_override"
    FOR INSERT
    WITH CHECK ("tenant_id" = app_current_tenant_id() AND app_is_platform_actor());
CREATE POLICY entitlement_override_platform_update ON "entitlement_override"
    FOR UPDATE
    USING ("tenant_id" = app_current_tenant_id() AND app_is_platform_actor())
    WITH CHECK ("tenant_id" = app_current_tenant_id() AND app_is_platform_actor());

-- Billing audit trail: append-only for the runtime role.
ALTER TABLE "subscription_event" ENABLE ROW LEVEL SECURITY;
CREATE POLICY subscription_event_read ON "subscription_event"
    FOR SELECT
    USING ("tenant_id" = app_current_tenant_id());
CREATE POLICY subscription_event_platform_insert ON "subscription_event"
    FOR INSERT
    WITH CHECK ("tenant_id" = app_current_tenant_id() AND app_is_platform_actor());

-- The platform console lists every organisation with its plan. Reading across tenants needs the platform
-- context, which tenant code paths never set — and no tenant context: once a transaction is scoped to one
-- organisation, it sees only that organisation, platform or not.
CREATE POLICY tenant_platform_read ON "tenant"
    FOR SELECT
    USING (app_is_platform_actor() AND app_current_tenant_id() IS NULL);
CREATE POLICY subscription_platform_read ON "subscription"
    FOR SELECT
    USING (app_is_platform_actor() AND app_current_tenant_id() IS NULL);

GRANT SELECT, INSERT, UPDATE ON "subscription" TO app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON "subscription_addon" TO app_rw;
GRANT SELECT, INSERT ON "entitlement_override" TO app_rw;
-- Overrides are revoked, never edited or deleted.
GRANT UPDATE ("revoked_at") ON "entitlement_override" TO app_rw;
GRANT SELECT, INSERT ON "subscription_event" TO app_rw;

-- ---------------------------------------------------------------------------------------------------------
-- Lifecycle sweep: subscriptions whose trial or period, plus grace, has run out but whose stored status
-- does not say EXPIRED yet. Mirrors effectiveStatus() in @smart-hr/entitlements. Returns tenant ids only;
-- the worker then records the expiry inside each tenant as a platform actor.
-- ---------------------------------------------------------------------------------------------------------
CREATE FUNCTION subscriptions_due_to_expire(p_limit integer)
    RETURNS TABLE (tenant_id uuid)
    LANGUAGE sql
    SECURITY DEFINER
    SET search_path = public
    AS $$
        SELECT s."tenant_id"
        FROM "subscription" s
        JOIN "plan_version" v ON v."id" = s."plan_version_id"
        WHERE (s."status" = 'TRIAL'
               AND coalesce(s."grace_ends_at", s."trial_ends_at" + make_interval(days => v."grace_days")) <= now())
           OR (s."status" = 'ACTIVE'
               AND coalesce(s."grace_ends_at", s."current_period_end" + make_interval(days => v."grace_days")) <= now())
           OR (s."status" = 'PAST_DUE'
               AND coalesce(s."grace_ends_at", s."current_period_end" + make_interval(days => v."grace_days")) <= now())
           OR (s."status" = 'CANCELLED' AND s."current_period_end" <= now())
        ORDER BY s."updated_at"
        LIMIT least(p_limit, 500)
    $$;

REVOKE ALL ON FUNCTION subscriptions_due_to_expire(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION subscriptions_due_to_expire(integer) TO app_rw;
