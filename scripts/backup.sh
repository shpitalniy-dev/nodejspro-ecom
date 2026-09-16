#!/usr/bin/env bash
#
# Manual/cron backup: pg_dump (custom format) straight from the postgres
# container, never through PgBouncer — a dump is one long-lived operation
# with nothing to pool, and going through PgBouncer would just tie up one of
# its 10 backend slots for no benefit. Runs pg_dump via `docker compose exec`
# rather than a host-installed pg_dump, so the dump's format always matches
# the server's own version (postgres:17-alpine) instead of whatever pg_dump
# happens to be on the machine running cron.
#
#   bash scripts/backup.sh
#
# Install as a nightly job: see backup.cron.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BACKUP_DIR="$ROOT/backups"
KEEP=14
mkdir -p "$BACKUP_DIR"

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_FILE="$BACKUP_DIR/ecom_${TIMESTAMP}.dump"

echo "backup: dumping ecom → $OUT_FILE"
T0=$(date +%s)
docker compose exec -T postgres pg_dump -U admin -d ecom -Fc > "$OUT_FILE"
DURATION=$(( $(date +%s) - T0 ))

SIZE="$(du -h "$OUT_FILE" | cut -f1)"
echo "backup: done — $SIZE in ${DURATION}s"

# Retention: keep the last $KEEP dumps, oldest first.
COUNT=$(find "$BACKUP_DIR" -maxdepth 1 -name 'ecom_*.dump' | wc -l | tr -d ' ')
if [ "$COUNT" -gt "$KEEP" ]; then
  PRUNE=$(( COUNT - KEEP ))
  echo "backup: pruning $PRUNE old dump(s), keeping the last $KEEP"
  find "$BACKUP_DIR" -maxdepth 1 -name 'ecom_*.dump' -print0 \
    | xargs -0 ls -1 \
    | sort \
    | head -n "$PRUNE" \
    | xargs rm -f
fi
