#!/usr/bin/env bash
# Database dump behind pra-backup.service (P-27): pg_dump in custom format (compressed) from the
# Compose Postgres into PRA_BACKUP_DIR, then dumps older than PRA_BACKUP_KEEP_DAYS are removed.
# Restore: docker exec -i pra-mikrus-db-1 pg_restore -U pra -d pra --clean --if-exists < <file>
set -euo pipefail

dir="${PRA_BACKUP_DIR:-/var/backups/pra}"
keep_days="${PRA_BACKUP_KEEP_DAYS:-14}"
container="${PRA_DB_CONTAINER:-pra-mikrus-db-1}"

umask 077
mkdir -p "$dir"
out="$dir/pra-$(date -u +%Y%m%dT%H%M%SZ).dump"
# Written under a temporary name so a failed dump never looks like a good one.
docker exec "$container" pg_dump --username=pra --dbname=pra --format=custom >"$out.partial"
mv "$out.partial" "$out"

find "$dir" -maxdepth 1 -type f -name 'pra-*.dump' -mtime +"$keep_days" -delete
find "$dir" -maxdepth 1 -type f -name '*.partial' -mmin +60 -delete
echo "backup written: $out ($(du -h "$out" | cut -f1)); dumps kept: $(find "$dir" -maxdepth 1 -name 'pra-*.dump' | wc -l)"
