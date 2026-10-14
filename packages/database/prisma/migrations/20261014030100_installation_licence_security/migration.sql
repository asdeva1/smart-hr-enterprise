-- Hand-written migration: the installation identity and its licences.

-- Exactly one installation row, created here with a random id. The runtime role can only read it, so the
-- id an in-house licence is bound to cannot be changed from the application.
INSERT INTO "installation" ("id") VALUES (gen_random_uuid());
GRANT SELECT ON "installation" TO app_rw;

-- Every request reads the current licence to resolve entitlements, so anyone may read; only platform actors
-- (the licence page in the platform console) may install one or mark one replaced. Nothing is ever deleted,
-- so the history of installed licences stays available.
ALTER TABLE "installation_licence" ENABLE ROW LEVEL SECURITY;
CREATE POLICY installation_licence_read ON "installation_licence"
    FOR SELECT
    USING (true);
CREATE POLICY installation_licence_platform_insert ON "installation_licence"
    FOR INSERT
    WITH CHECK (app_is_platform_actor());
CREATE POLICY installation_licence_platform_update ON "installation_licence"
    FOR UPDATE
    USING (app_is_platform_actor())
    WITH CHECK (app_is_platform_actor());

GRANT SELECT, INSERT ON "installation_licence" TO app_rw;
GRANT UPDATE ("replaced_at") ON "installation_licence" TO app_rw;
