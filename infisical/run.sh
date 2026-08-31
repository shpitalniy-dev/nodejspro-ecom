#!/usr/bin/env bash
# Run any command with secrets from the store, authenticated as the MACHINE
# identity (not a human login) — adapted from Lecture 11's own run.sh.
#
#   bash infisical/run.sh dev  node infisical/demo.js
#   bash infisical/run.sh prod node infisical/demo.js
#   bash infisical/run.sh dev  env               # see exactly what got injected
#
# The mechanics, worth saying out loud:
#   1. `infisical login --method=universal-auth` exchanges the clientId/
#      clientSecret pair for a short-lived access token (2h TTL). This is
#      what "the machine authenticates" actually means.
#   2. `infisical run -- <cmd>` fetches secrets using that token and puts
#      them in the CHILD process's env. Nothing is ever written to disk —
#      no .env, no temp file.
#   3. The child process is just `node demo.js`, reading process.env like
#      any other config.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

CREDS="$HERE/.secrets/machine-identity.env"
if [ ! -f "$CREDS" ]; then
  echo "✗ Missing $CREDS — bring up the stand first: bash infisical/up.sh" >&2
  exit 1
fi

set -a
# shellcheck source=/dev/null
. "$CREDS"
set +a

ENV_SLUG="${1:-dev}"
shift || true
[ "$#" -gt 0 ] || set -- node "$HERE/demo.js"

# Cache the machine token for an hour — otherwise every run is an extra
# round trip to the store for no reason.
TOKEN_CACHE="$HERE/.secrets/machine-token"
if [ -f "$TOKEN_CACHE" ] && [ -n "$(find "$TOKEN_CACHE" -mmin -60 2>/dev/null)" ]; then
  INFISICAL_TOKEN="$(cat "$TOKEN_CACHE")"
else
  INFISICAL_TOKEN="$(
    infisical login --method=universal-auth \
      --client-id="$INFISICAL_CLIENT_ID" \
      --client-secret="$INFISICAL_CLIENT_SECRET" \
      --domain="$INFISICAL_URL" --silent --plain
  )"
  (
    umask 077
    printf '%s' "$INFISICAL_TOKEN" >"$TOKEN_CACHE"
  )
fi
export INFISICAL_TOKEN

# `set -a` above exported clientSecret too, which would otherwise leak into
# the child process's env alongside the one secret it actually needs. Only
# the short-lived token should survive past this point.
unset INFISICAL_CLIENT_ID INFISICAL_CLIENT_SECRET

exec infisical run \
  --domain="$INFISICAL_URL" \
  --projectId="$INFISICAL_PROJECT_ID" \
  --project-config-dir="$HERE" \
  --env="$ENV_SLUG" \
  --silent \
  -- "$@"
