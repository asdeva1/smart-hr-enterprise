-- Hand-written migration: security rules for single sign-on.
ALTER TABLE "sso_connection" ENABLE ROW LEVEL SECURITY;
-- Organisation administrators manage their own connection.
CREATE POLICY tenant_isolation ON "sso_connection" FOR ALL
    USING ("tenant_id" = app_current_tenant_id()) WITH CHECK ("tenant_id" = app_current_tenant_id());
-- Signing in happens before anyone has an organisation, so the sign-in path may look a connection up by the
-- email domain; it may read, never write, and only enabled connections.
CREATE POLICY sso_sign_in_read ON "sso_connection" FOR SELECT
    USING ("enabled" = true AND current_setting('app.sso_lookup', true) = 'on');

GRANT SELECT, INSERT, UPDATE ON "sso_connection" TO app_rw;

ALTER TABLE "sso_connection" ADD CONSTRAINT "sso_connection_domains_check" CHECK (
    cardinality("allowed_domains") BETWEEN 1 AND 20);
ALTER TABLE "sso_connection" ADD CONSTRAINT "sso_connection_issuer_check" CHECK (
    "issuer" ~ '^https?://[^[:space:]]+$' AND length("issuer") <= 500);
-- A connection can only be enforced while it is enabled.
ALTER TABLE "sso_connection" ADD CONSTRAINT "sso_connection_enforced_check" CHECK ("enforced" = false OR "enabled" = true);

ALTER TABLE "user_session" ADD CONSTRAINT "user_session_sso_tenant_fkey"
    FOREIGN KEY ("sso_tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
