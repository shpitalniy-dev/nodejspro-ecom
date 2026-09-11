#!/usr/bin/env bash
#
# Runs a command with the project's config in its environment, fetched from
# Infisical. Used to wrap every npm script that talks to the database
# (migrate, seed, demo:nplus1, report).
#
#   bash scripts/with-secrets.sh <env-slug> <command...>
#
# The grader has no access to the vault, so it runs these with SKIP_VAULT=1
# and the DB_* values already exported (see README's ## Grading). The
# insertion point of that check is fixed: after ENV_SLUG is split off the
# args, before the vault is touched.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

ENV_SLUG="${1:-dev}"; shift || true

[ "$#" -gt 0 ] || set -- npm run start

# The grader has no access to the vault
if [ "${SKIP_VAULT:-0}" = "1" ]; then exec "$@"; fi

# Machine identity (universal auth), read-only — the same reader identity
# infisical-agent uses. client_secret is gitignored (see infisical/README.md).
CLIENT_ID="$(cat "$ROOT/infisical/configs/client_id")"
CLIENT_SECRET="$(cat "$ROOT/infisical/secrets/client_secret")"
PROJECT_ID="$(cat "$ROOT/infisical/configs/project_id")"

INFISICAL_TOKEN="$(
  infisical login --method=universal-auth \
    --client-id="$CLIENT_ID" \
    --client-secret="$CLIENT_SECRET" \
    --silent --plain
)"

exec infisical run \
  --token="$INFISICAL_TOKEN" \
  --projectId="$PROJECT_ID" \
  --env="$ENV_SLUG" \
  -- "$@"
