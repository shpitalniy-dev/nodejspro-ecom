#!/usr/bin/env bash
#
# Restore-drill (HW #15 grading requirement): prove a backup actually
# restores, because it's been restored — not just that a file exists on
# disk. Takes a fresh dump, restores it into a genuinely empty throwaway
# Postgres (own volume, own port, no db/init.sql — never shares state with
# the real `postgres`), and compares a checksum before/after. Prints RTO
# (measured) and RPO (from the backup schedule) for RESTORE-DRILL.md.
#
#   bash scripts/restore-drill.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Exact volume name Compose itself uses (<project>_<volume-key>) — never a
# substring filter. `docker volume ls --filter name=...` matches ANY volume
# on the host whose name CONTAINS that string, not just this project's; on a
# host running other Compose projects, that risks deleting someone else's
# volume entirely by accident. Compose derives the project name from the
# directory unless COMPOSE_PROJECT_NAME overrides it — mirror that here
# rather than guessing.
PROJECT_NAME="${COMPOSE_PROJECT_NAME:-$(basename "$ROOT" | tr '[:upper:]' '[:lower:]')}"
RESTORE_VOLUME="${PROJECT_NAME}_pgdata_restore"

# The throwaway `restore` container/volume must not outlive this script,
# success or failure — otherwise it only gets cleaned up at the START of the
# *next* run, and never at all if there isn't one. `docker compose rm -v`
# only removes anonymous volumes, not named ones like pgdata_restore, so the
# explicit `docker volume rm` stays even with -v on the rm above it.
cleanup() {
  docker compose --profile drill rm -sfv restore >/dev/null 2>&1 || true
  docker volume rm -f "$RESTORE_VOLUME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# Millisecond timer — a plain integer $(date +%s) would round this drill's
# sub-second restore down to "0s", which isn't a measurement. bash >= 5 has
# EPOCHREALTIME built in (cost ~0); macOS's default bash 3.2 doesn't, so
# fall back to perl.
if [ -n "${EPOCHREALTIME:-}" ]; then
  now_ms() { local t="${EPOCHREALTIME/[.,]/}"; echo "${t:0:${#t}-3}"; }
else
  now_ms() { perl -MTime::HiRes -e 'printf("%.0f\n", Time::HiRes::time()*1000)'; }
fi
secs() { awk -v ms="$1" 'BEGIN { printf "%.3f", ms / 1000 }'; }

checksum() {
  docker compose exec -T "$1" psql -U admin -d ecom -Atc \
    "SELECT count(*) || '|' || coalesce(sum(amount_cents), 0) FROM orders"
}

echo "━━━ 1. Fresh dump ━━━"
bash scripts/backup.sh
DUMP_FILE="$(ls -1t backups/ecom_*.dump | head -1)"
echo "  using: $DUMP_FILE"

echo "━━━ 2. Checksum on the real postgres ━━━"
BEFORE="$(checksum postgres)"
echo "  orders before: $BEFORE  (count|sum(amount_cents))"

echo "━━━ 3. Clean slate: throwaway 'restore' target ━━━"
cleanup
docker compose --profile drill up -d --wait restore

EMPTY="$(docker compose exec -T restore psql -U admin -d ecom -Atc \
  "SELECT count(*) FROM pg_tables WHERE tablename = 'orders'")"
echo "  orders table present in clean restore target: $EMPTY (must be 0)"
if [ "$EMPTY" != "0" ]; then
  echo "  restore target isn't empty — drill wouldn't prove anything"
  exit 1
fi

echo "━━━ 4. pg_restore + timing (RTO) ━━━"
T0=$(now_ms)
docker compose exec -T restore pg_restore -U admin -d ecom --no-owner < "$DUMP_FILE"
RESTORE_MS=$(( $(now_ms) - T0 ))

echo "━━━ 5. Checksum on the restored target ━━━"
AFTER="$(checksum restore)"
echo "  orders after restore: $AFTER"

if [ "$BEFORE" = "$AFTER" ]; then
  echo "  MATCH — restored data is identical to the source, by checksum"
else
  echo "  MISMATCH: '$BEFORE' != '$AFTER'"
  exit 1
fi

echo "━━━ 6. RTO / RPO ━━━"
echo "  RTO (this drill): $(secs "$RESTORE_MS")s — pg_restore itself, on top of the already-running restore target"
echo "  RPO: bounded by the backup schedule (backup.cron, nightly) — up to ~24h of data lost in the worst case"

echo
echo "Cleanup: automatic on exit (trap) — no manual step needed."
