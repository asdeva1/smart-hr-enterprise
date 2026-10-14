#!/usr/bin/env bash
# Restores a backup made by backup.sh into an EMPTY installation (for example a new server, or a test
# copy). It refuses to touch a database that already has Smart HR data, so it can never overwrite a live
# installation. To replace live data, stop here and follow docs/deployment/IN_HOUSE.md ("Restoring").
#   ./restore.sh ./backups/smart-hr-20261014T020000Z.dump
set -euo pipefail
cd "$(dirname "$0")"

file="${1:?Usage: ./restore.sh <backup.dump>}"
[[ -f "$file" ]] || { echo "No such file: $file" >&2; exit 1; }

tables=$(docker compose exec -T postgres psql -U postgres -d smart_hr -tAc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'tenant'")
if [[ "$tables" != "0" ]]; then
  echo "This database already has Smart HR tables. Refusing to restore over it." >&2
  exit 1
fi

# Roles first (idempotent), so grants in the backup resolve; objects are recreated owned by the migrator.
docker compose --profile setup run --rm db-init
docker compose exec -T postgres pg_restore -U postgres -d smart_hr --no-owner --role=app_migrator \
  --exit-on-error <"$file"
echo "Restored $file. Now run: docker compose --profile setup run --rm migrate"
