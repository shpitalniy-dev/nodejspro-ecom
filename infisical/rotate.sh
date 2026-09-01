#!/usr/bin/env bash
# Rotates app_user's DB password via Infisical. Just one step now: generate
# a value and push it to Infisical Cloud, authenticated as the rotator
# machine identity (write-scoped, separate from the read-only identity
# infisical-agent uses).
#
# Neither ALTER ROLE nor terminating old connections happens here anymore —
# both are infisical/on-change.sh's job, triggered automatically the moment
# infisical-agent notices the value changed. That's what makes it safe for
# ANYTHING (this script, a human in the UI, another script) to be the thing
# that changes DB_PASSWORD — on-change.sh syncs Postgres to match, whatever
# the source.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

NEW_PASSWORD="app-$(openssl rand -hex 8)"
PROJECT_ID="$(cat infisical/configs/project_id)"
INFISICAL_ENV="${INFISICAL_ENV:-dev}"

ROTATOR_CLIENT_ID="$(cat infisical/configs/rotator_client_id)"
ROTATOR_CLIENT_SECRET="$(cat infisical/secrets/rotator_client_secret)"

INFISICAL_TOKEN="$(
  infisical login --method=universal-auth \
    --client-id="${ROTATOR_CLIENT_ID}" \
    --client-secret="${ROTATOR_CLIENT_SECRET}" \
    --silent --plain
)"
export INFISICAL_TOKEN

infisical secrets set "DB_PASSWORD=${NEW_PASSWORD}" \
  --projectId="${PROJECT_ID}" --env="${INFISICAL_ENV}" >/dev/null

echo "Pushed a new DB_PASSWORD to Infisical (${INFISICAL_ENV}) — infisical-agent will sync Postgres and terminate old connections on its next poll."
