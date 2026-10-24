-- Hand-written migration: only platform operators may see or change the licence register.
ALTER TABLE "issued_licence" ENABLE ROW LEVEL SECURITY;
CREATE POLICY issued_licence_platform_read ON "issued_licence"
    FOR SELECT USING (app_is_platform_actor());
CREATE POLICY issued_licence_platform_insert ON "issued_licence"
    FOR INSERT WITH CHECK (app_is_platform_actor());
CREATE POLICY issued_licence_platform_update ON "issued_licence"
    FOR UPDATE USING (app_is_platform_actor()) WITH CHECK (app_is_platform_actor());

-- Records are never deleted; a licence is revoked instead, so the history stays. Only the fields an operator
-- may change can be updated.
GRANT SELECT, INSERT ON "issued_licence" TO app_rw;
GRANT UPDATE ("notes", "status", "revoked_at", "revoked_reason", "renewed_by_id") ON "issued_licence" TO app_rw;

ALTER TABLE "issued_licence" ADD CONSTRAINT issued_licence_dates_check CHECK ("not_before" < "expires_at");
ALTER TABLE "issued_licence" ADD CONSTRAINT issued_licence_revoked_check
    CHECK (("status" = 'REVOKED') = ("revoked_at" IS NOT NULL));
