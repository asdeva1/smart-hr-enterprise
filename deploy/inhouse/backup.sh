#!/usr/bin/env bash
# Writes a consistent, compressed backup of the Smart HR database to ./backups (or the directory given).
#   ./backup.sh [/path/to/backups]
# Run it from cron, then copy the files off this server. The backup contains personal data: store it
# encrypted, with the same care as the live database. Keep MFA_ENCRYPTION_KEYS and DATA_ENCRYPTION_KEYS
# with it, or two-step verification secrets, identity numbers, bank details and documents in the backup can't be read.
set -euo pipefail
cd "$(dirname "$0")"

dest="${1:-./backups}"
mkdir -p "$dest"
chmod 700 "$dest"
file="$dest/smart-hr-$(date -u +%Y%m%dT%H%M%SZ).dump"

# Custom format: compressed, and restorable table by table. Read-only for the database.
docker compose exec -T postgres pg_dump -U postgres -d smart_hr --format=custom --no-owner >"$file.partial"
mv "$file.partial" "$file"
chmod 600 "$file"
echo "Backup written to $file ($(du -h "$file" | cut -f1))"

# Uploaded documents (already encrypted with DATA_ENCRYPTION_KEYS). Back them up with the database dump:
# each needs the other.
docs="$dest/smart-hr-documents-$(date -u +%Y%m%dT%H%M%SZ).tar.gz"
docker compose exec -T api tar -czf - -C /var/lib/smart-hr/documents . >"$docs.partial"
mv "$docs.partial" "$docs"
chmod 600 "$docs"
echo "Documents written to $docs ($(du -h "$docs" | cut -f1))"
