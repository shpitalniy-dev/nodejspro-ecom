#!/bin/sh
# Syncs Postgres to whatever's CURRENTLY in Infisical's rendered file.
# Called two ways: reactively, by infisical-agent's own `execute` hook
# (edge-triggered — only fires when the Agent's own diff sees a change
# relative to whatever's on the volume); and unconditionally, on a fixed
# schedule, by reconcile.sh (level-triggered — doesn't depend on detecting
# a transition at all). Since reconcile.sh calls this every tick regardless
# of whether anything actually changed, this MUST be a safe no-op when
# Postgres is already correct — otherwise it would kill live app_user
# connections every tick for no reason.
set -eu

NEW_PASSWORD="$(cat /shared-secrets/db-password)"

# Already correct — nothing to do. This check is what makes it safe to call
# unconditionally from reconcile.sh.
if PGPASSWORD="${NEW_PASSWORD}" psql -h postgres -U app_user -d "${POSTGRES_DB}" -c 'SELECT 1' >/dev/null 2>&1; then
  exit 0
fi

export PGPASSWORD="${POSTGRES_PASSWORD}"
ESCAPED_PASSWORD=$(printf '%s' "${NEW_PASSWORD}" | sed "s/'/''/g")

echo "on-change: syncing app_user's Postgres password to match Infisical…"
psql -h postgres -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -tA \
  -c "ALTER ROLE app_user WITH PASSWORD '${ESCAPED_PASSWORD}';" >/dev/null

echo "on-change: terminating old app_user connections…"
psql -h postgres -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -tA \
  -c "SELECT count(pg_terminate_backend(pid)) FROM pg_stat_activity WHERE usename = 'app_user';"
