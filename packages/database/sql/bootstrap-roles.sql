-- One-time database bootstrap. Run as a superuser (or the RDS master user) against the target database:
--
--   psql "$ADMIN_DATABASE_URL" \
--     -v migrator_password="$MIGRATOR_PASSWORD" \
--     -v app_password="$APP_PASSWORD" \
--     -f packages/database/sql/bootstrap-roles.sql
--
-- Creates two roles:
--   app_migrator  owns the schema; runs migrations only.
--   app_rw        the runtime role for api and worker; bound by row-level security.
-- Idempotent: safe to run again. Passwords come from variables, never from this file.

\set ON_ERROR_STOP on

SELECT format('CREATE ROLE app_migrator LOGIN PASSWORD %L', :'migrator_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_migrator') \gexec

SELECT format('CREATE ROLE app_rw LOGIN NOBYPASSRLS PASSWORD %L', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') \gexec

SELECT format('GRANT CONNECT ON DATABASE %I TO app_migrator, app_rw', current_database()) \gexec

-- Only the migrator may create objects; the runtime role may only use them.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO app_migrator;
GRANT USAGE ON SCHEMA public TO app_rw;
