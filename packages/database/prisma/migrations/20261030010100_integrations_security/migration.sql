-- Hand-written migration: row-level security, grants and the narrow cross-organisation functions for integrations.

ALTER TABLE "api_key" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "api_key"
    FOR ALL USING ("tenant_id" = app_current_tenant_id()) WITH CHECK ("tenant_id" = app_current_tenant_id());

ALTER TABLE "webhook_endpoint" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "webhook_endpoint"
    FOR ALL USING ("tenant_id" = app_current_tenant_id()) WITH CHECK ("tenant_id" = app_current_tenant_id());

ALTER TABLE "webhook_delivery" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "webhook_delivery"
    FOR ALL USING ("tenant_id" = app_current_tenant_id()) WITH CHECK ("tenant_id" = app_current_tenant_id());

-- Keys are revoked, never deleted; an endpoint is disabled rather than deleted so its delivery history stays.
GRANT SELECT, INSERT, UPDATE ON "api_key" TO app_rw;
GRANT SELECT, INSERT, UPDATE ON "webhook_endpoint" TO app_rw;
GRANT SELECT, INSERT, UPDATE ON "webhook_delivery" TO app_rw;

ALTER TABLE "api_key" ADD CONSTRAINT "api_key_scopes_present" CHECK (cardinality("scopes") > 0);
ALTER TABLE "webhook_endpoint" ADD CONSTRAINT "webhook_endpoint_https" CHECK ("url" ~* '^https://');
ALTER TABLE "webhook_endpoint" ADD CONSTRAINT "webhook_endpoint_events_present" CHECK (cardinality("events") > 0);

-- ---------------------------------------------------------------------------------------------------------
-- An API key arrives before the organisation is known, so it is found by its public prefix through one narrow
-- function that returns only what checking the key needs.
-- ---------------------------------------------------------------------------------------------------------
CREATE FUNCTION find_api_key(p_prefix text)
    RETURNS TABLE (id uuid, tenant_id uuid, secret_hash text, scopes text[], expires_at timestamptz, revoked_at timestamptz)
    LANGUAGE sql
    SECURITY DEFINER
    SET search_path = public
    AS $$
        SELECT k."id", k."tenant_id", k."secret_hash", k."scopes", k."expires_at", k."revoked_at"
        FROM "api_key" k WHERE k."prefix" = p_prefix
    $$;

CREATE FUNCTION touch_api_key(p_id uuid)
    RETURNS void
    LANGUAGE sql
    SECURITY DEFINER
    SET search_path = public
    AS $$
        UPDATE "api_key" SET "last_used_at" = now()
        WHERE "id" = p_id AND ("last_used_at" IS NULL OR "last_used_at" < now() - interval '1 minute')
    $$;

-- ---------------------------------------------------------------------------------------------------------
-- Webhook delivery runs across organisations, like the email outbox: rows are claimed with SKIP LOCKED so
-- several workers never send the same delivery, and only what sending needs is returned.
-- ---------------------------------------------------------------------------------------------------------
CREATE FUNCTION claim_webhook_deliveries(p_limit integer, p_reclaim_after_seconds integer)
    RETURNS TABLE (id uuid, tenant_id uuid, endpoint_id uuid, event_id uuid, event_type text, payload jsonb,
                   attempts integer, created_at timestamptz, url text, secret_enc text)
    LANGUAGE sql
    SECURITY DEFINER
    SET search_path = public
    AS $$
        WITH picked AS (
            UPDATE "webhook_delivery" d
            SET "claimed_at" = now(), "attempts" = d."attempts" + 1
            WHERE d."id" IN (
                SELECT c."id" FROM "webhook_delivery" c
                JOIN "webhook_endpoint" e ON e."id" = c."endpoint_id" AND e."tenant_id" = c."tenant_id"
                WHERE c."status" = 'PENDING' AND e."status" = 'ACTIVE'
                  AND c."next_attempt_at" <= now()
                  AND (c."claimed_at" IS NULL
                       OR c."claimed_at" < now() - make_interval(secs => p_reclaim_after_seconds))
                ORDER BY c."next_attempt_at"
                LIMIT least(p_limit, 200)
                FOR UPDATE OF c SKIP LOCKED
            )
            RETURNING d."id", d."tenant_id", d."endpoint_id", d."event_id", d."event_type", d."payload",
                      d."attempts", d."created_at"
        )
        SELECT p."id", p."tenant_id", p."endpoint_id", p."event_id", p."event_type", p."payload", p."attempts",
               p."created_at", e."url", e."secret_enc"
        FROM picked p JOIN "webhook_endpoint" e ON e."id" = p."endpoint_id" AND e."tenant_id" = p."tenant_id"
    $$;

-- Records one attempt. A failure is retried with growing waits (1, 4, 16, ... minutes) until the attempts run
-- out, then the delivery is FAILED. An endpoint that keeps failing for good is switched off.
CREATE FUNCTION complete_webhook_delivery(p_id uuid, p_ok boolean, p_status integer, p_error text,
                                          p_max_attempts integer, p_disable_after integer)
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
    AS $$
    DECLARE
        d "webhook_delivery"%ROWTYPE;
        gave_up boolean;
    BEGIN
        SELECT * INTO d FROM "webhook_delivery" WHERE "id" = p_id AND "status" = 'PENDING' FOR UPDATE;
        IF NOT FOUND THEN RETURN; END IF;
        gave_up := NOT p_ok AND d."attempts" >= p_max_attempts;
        UPDATE "webhook_delivery"
        SET "status" = CASE WHEN p_ok THEN 'SENT'::webhook_delivery_status
                            WHEN gave_up THEN 'FAILED'::webhook_delivery_status
                            ELSE 'PENDING'::webhook_delivery_status END,
            "delivered_at" = CASE WHEN p_ok THEN now() ELSE NULL END,
            "last_status_code" = p_status,
            "last_error" = CASE WHEN p_ok THEN NULL ELSE left(p_error, 300) END,
            "claimed_at" = NULL,
            "next_attempt_at" = CASE WHEN p_ok OR gave_up THEN "next_attempt_at"
                                     ELSE now() + make_interval(mins => power(4, least(d."attempts" - 1, 6))::int) END,
            -- A delivered payload may hold personal data and is no longer needed.
            "payload" = CASE WHEN p_ok THEN '{}'::jsonb ELSE "payload" END
        WHERE "id" = p_id;
        IF p_ok THEN
            UPDATE "webhook_endpoint" SET "failure_streak" = 0
            WHERE "id" = d."endpoint_id" AND "tenant_id" = d."tenant_id" AND "failure_streak" <> 0;
        ELSIF gave_up THEN
            UPDATE "webhook_endpoint"
            SET "failure_streak" = "failure_streak" + 1,
                "status" = CASE WHEN "failure_streak" + 1 >= p_disable_after THEN 'DISABLED'::webhook_status ELSE "status" END
            WHERE "id" = d."endpoint_id" AND "tenant_id" = d."tenant_id";
        END IF;
    END
    $$;

REVOKE ALL ON FUNCTION find_api_key(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION touch_api_key(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION claim_webhook_deliveries(integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION complete_webhook_delivery(uuid, boolean, integer, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION find_api_key(text) TO app_rw;
GRANT EXECUTE ON FUNCTION touch_api_key(uuid) TO app_rw;
GRANT EXECUTE ON FUNCTION claim_webhook_deliveries(integer, integer) TO app_rw;
GRANT EXECUTE ON FUNCTION complete_webhook_delivery(uuid, boolean, integer, text, integer, integer) TO app_rw;
