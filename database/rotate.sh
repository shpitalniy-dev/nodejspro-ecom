#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

NEW_PASSWORD="app-$(openssl rand -hex 8)"

echo "1. ALTER ROLE app_user in Postgres…"
docker compose exec -T postgres psql -U admin -d ecom \
  -c "ALTER ROLE app_user WITH PASSWORD '${NEW_PASSWORD}';" >/dev/null

echo "2. Updating the secret file…"
printf '%s' "${NEW_PASSWORD}" > secrets/db_password

echo "3. Terminating old app_user connections…"
docker compose exec -T postgres psql -U admin -d ecom -tA \
  -c "SELECT count(pg_terminate_backend(pid)) FROM pg_stat_activity WHERE usename = 'app_user';"

echo "The application has NOT been restarted — check: curl -s localhost:3000/health/db"
