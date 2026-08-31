#!/usr/bin/env bash
# Bonus (no points): tears down the standalone Infisical stand — containers,
# volume, and the local credentials directory. The machine identity's
# clientSecret is shown exactly once by the API, so once this stand is gone
# there's no way to recover it; a fresh `up.sh` mints new ones.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

docker compose down -v
rm -rf .secrets
echo "Infisical stand removed (containers, volume, .secrets/)."
