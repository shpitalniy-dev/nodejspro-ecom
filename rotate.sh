#!/usr/bin/env bash
# app_user's password is now sourced from Infisical (see infisical/README.md)
# — DatabaseService reads it from the file infisical-agent keeps current,
# not from a locally-managed secrets/db_password file. Rotating it directly
# against Postgres here, bypassing Infisical, would just get immediately
# overwritten (or fought over) by infisical-agent's own reconciliation. This
# script is now a thin wrapper so `bash rotate.sh` still does the right
# thing without you needing to remember the new location.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

exec bash infisical/rotate.sh
