#!/usr/bin/env bash
# Runs once, on the first start of the local Postgres container.
# Creates the app database, a shadow database for Prisma, and the two application roles.
# Local development passwords only — real environments get theirs from AWS Secrets Manager.
set -euo pipefail

for db in smart_hr smart_hr_shadow; do
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" -c "CREATE DATABASE ${db}"
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$db" \
    -v migrator_password=app_migrator_local \
    -v app_password=app_rw_local \
    -f /bootstrap/bootstrap-roles.sql
done
