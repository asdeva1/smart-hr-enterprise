#!/usr/bin/env bash
# Guards the database workflow (docs/development/database.md):
#   1. No script or workflow may run `prisma db push` or `prisma migrate reset`.
#   2. Destructive statements in a migration need an explicit, reviewed approval comment:
#        -- approved-destructive: <reason or ticket>
set -euo pipefail
cd "$(dirname "$0")/.."

status=0

forbidden=$(grep -rnE 'prisma (db push|migrate reset)' \
  --include=package.json --include='*.yml' --include='*.yaml' --include='*.sh' \
  --exclude-dir=node_modules --exclude=check-migrations.sh . || true)
if [[ -n "$forbidden" ]]; then
  echo "::error::Forbidden Prisma command found (db push / migrate reset):"
  echo "$forbidden"
  status=1
fi

destructive='DROP[[:space:]]+(TABLE|COLUMN|SCHEMA|TYPE|INDEX)|TRUNCATE|ALTER[[:space:]]+COLUMN[^;]*[[:space:]]TYPE[[:space:]]|DELETE[[:space:]]+FROM'
for file in packages/database/prisma/migrations/*/migration.sql; do
  [[ -e "$file" ]] || continue
  if grep -qiE "$destructive" "$file" && ! grep -qE '^-- approved-destructive: .+' "$file"; then
    echo "::error file=$file::Destructive SQL without an '-- approved-destructive: <reason>' comment"
    grep -niE "$destructive" "$file"
    status=1
  fi
done

if [[ $status -eq 0 ]]; then
  echo "Migration guard passed."
fi
exit $status
