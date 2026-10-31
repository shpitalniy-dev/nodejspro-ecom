#!/usr/bin/env bash
#
# PITR drill (bonus, beyond HW #15's grading requirement): point-in-time
# recovery — base backup + continuous WAL archive, restored to the exact
# moment before a simulated incident. Where scripts/restore-drill.sh proves
# "last night's dump restores" (RPO ~24h), this proves "recover to the
# second before someone ran a bad DELETE" (RPO ~0).
#
# DESTRUCTIVE BY DESIGN: this deletes real rows from `orders` on the actual
# `postgres` service, on purpose, to have a real incident to recover from —
# mirrors the lecture's own DROP TABLE on its `primary`. Run `npm run seed`
# afterward to restore demo data.
#
#   bash scripts/pitr-drill.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [ -n "${EPOCHREALTIME:-}" ]; then
  now_ms() { local t="${EPOCHREALTIME/[.,]/}"; echo "${t:0:${#t}-3}"; }
else
  now_ms() { perl -MTime::HiRes -e 'printf("%.0f\n", Time::HiRes::time()*1000)'; }
fi
secs() { awk -v ms="$1" 'BEGIN { printf "%.3f", ms / 1000 }'; }

psql_pg() { docker compose exec -T postgres psql -U admin -d ecom -Atc "$1"; }
checksum_pg() { psql_pg "SELECT count(*) || '|' || coalesce(sum(amount_cents), 0) FROM orders"; }
checksum_pitr() {
  docker compose exec -T pitr psql -U admin -d ecom -Atc \
    "SELECT count(*) || '|' || coalesce(sum(amount_cents), 0) FROM orders"
}

echo "━━━ 0. Clean slate ━━━"
docker compose --profile pitr rm -sf pitr >/dev/null 2>&1 || true
OLD_PITR_VOLUME="$(docker volume ls -q --filter name=pgdata_pitr)"
[ -n "$OLD_PITR_VOLUME" ] && docker volume rm -f "$OLD_PITR_VOLUME" >/dev/null 2>&1
docker compose exec -T postgres sh -c 'rm -rf /basebackup/base' >/dev/null 2>&1 || true
# `create` (not `up`) provisions the pitr service's fresh named volume
# without starting the container — we need it to exist so we can populate
# it from the base backup below, before Postgres itself ever touches it.
docker compose --profile pitr create pitr >/dev/null 2>&1
PITR_VOLUME="$(docker volume ls -q --filter name=pgdata_pitr)"
WAL_ARCHIVE_VOLUME="$(docker volume ls -q --filter name=wal_archive)"
BASEBACKUP_VOLUME="$(docker volume ls -q --filter name=basebackup)"
echo "  removed any previous pitr container/volume/base backup, provisioned a fresh pgdata_pitr volume"

echo "━━━ 1. Baseline checksum ━━━"
BASELINE="$(checksum_pg)"
echo "  orders now: $BASELINE  (count|sum(amount_cents))"

echo "━━━ 2. T0 — base backup ━━━"
T0=$(now_ms)
docker compose exec -T postgres bash -c \
  'PGPASSWORD=admin-bootstrap-password pg_basebackup -h 127.0.0.1 -U admin -D /basebackup/base -Fp -Xs -c fast'
BACKUP_MS=$(( $(now_ms) - T0 ))
SIZE="$(docker compose exec -T postgres du -sh /basebackup/base | cut -f1)"
echo "  base backup: $SIZE in $(secs "$BACKUP_MS")s"

echo "━━━ 3. T0 → T1 — a 'good' transaction after the backup ━━━"
GOOD_USER_ID="$(psql_pg 'SELECT id FROM users ORDER BY id LIMIT 1')"
psql_pg "INSERT INTO orders (currency, amount_cents, status, user_id) VALUES ('USD', 424242, 'unpaid', ${GOOD_USER_ID})" >/dev/null
T_TARGET="$(psql_pg 'SELECT now()')"
TARGET_CHECKSUM="$(checksum_pg)"
echo "  inserted 1 order after the backup — this must survive the drill"
echo "  recovery target (T1): $T_TARGET"
echo "  orders at T1: $TARGET_CHECKSUM"

echo "━━━ 4. T2 — simulated incident ━━━"
echo "  \$ TRUNCATE orders CASCADE;  (order_items/fulfillments reference orders — a plain DELETE would fail on that FK)"
psql_pg "TRUNCATE orders CASCADE" >/dev/null
AFTER_INCIDENT="$(checksum_pg)"
echo "  orders on postgres now: $AFTER_INCIDENT"

echo "━━━ 5. Force the WAL archive ━━━"
psql_pg "SELECT pg_switch_wal()" >/dev/null
sleep 2
ARCHIVED="$(psql_pg 'SELECT archived_count FROM pg_stat_archiver')"
echo "  WAL segments archived so far: $ARCHIVED"

# From here on: this is the actual recovery — everything above (backup,
# archiving) already happened before the incident was even noticed.
echo "━━━ 6. Recovery starts: populate pgdata_pitr from the base backup ━━━"
T0=$(now_ms)
docker run --rm \
  -v "$BASEBACKUP_VOLUME":/basebackup:ro \
  -v "$PITR_VOLUME":/pgdata \
  postgres:17-alpine bash -c '
    rm -rf /pgdata/* &&
    cp -a /basebackup/base/. /pgdata/ &&
    rm -f /pgdata/postmaster.pid &&
    chown -R postgres:postgres /pgdata && chmod 700 /pgdata' >/dev/null

echo "━━━ 7. Write recovery config, targeting T1 ━━━"
docker run --rm -v "$PITR_VOLUME":/pgdata postgres:17-alpine bash -c "
  cat >> /pgdata/postgresql.auto.conf <<EOF
restore_command = 'cp /wal_archive/%f %p'
recovery_target_time = '${T_TARGET}'
recovery_target_action = 'promote'
EOF
  touch /pgdata/recovery.signal
  chown postgres:postgres /pgdata/postgresql.auto.conf /pgdata/recovery.signal" >/dev/null

echo "━━━ 8. Bring up pitr — it replays WAL and stops/promotes at T1 ━━━"
docker compose --profile pitr up -d --wait pitr

echo "━━━ 9. Verify ━━━"
RESTORED="$(checksum_pitr)"
IN_RECOVERY="$(docker compose exec -T pitr psql -U admin -d ecom -Atc 'SELECT pg_is_in_recovery()')"
RECOVERY_MS=$(( $(now_ms) - T0 ))
echo "  orders on pitr: $RESTORED  (expected: $TARGET_CHECKSUM)"
echo "  pg_is_in_recovery: $IN_RECOVERY  (expected: f — promoted)"

if [ "$RESTORED" = "$TARGET_CHECKSUM" ] && [ "$IN_RECOVERY" = "f" ]; then
  echo "  MATCH — recovered exactly to the moment before the incident"
else
  echo "  MISMATCH"
  exit 1
fi

echo "━━━ 10. RTO / RPO ━━━"
echo "  RTO (this drill): $(secs "$RECOVERY_MS")s — from starting recovery (populate volume) to a verified, promoted instance"
echo "  RPO: 0 — recovered to the instant before the incident, thanks to continuous WAL archiving"
echo "  (contrast: scripts/restore-drill.sh's nightly-dump-only RPO is ~24h)"

echo
echo "Cleanup: docker compose --profile pitr rm -sf pitr && docker volume rm \$(docker volume ls -q --filter name=pgdata_pitr)"
echo "Restore demo data on the real postgres: npm run seed"
