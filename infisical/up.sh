#!/usr/bin/env bash
# Bonus (no points): brings up the standalone Infisical stand and populates
# it via its own API — one command. Idempotent: a rerun doesn't break
# anything or regenerate secrets that already exist.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

command -v infisical >/dev/null || {
  echo "✗ Missing the infisical CLI. Install: npm i -g @infisical/cli" >&2
  exit 1
}

echo "-- containers (compose project nodejspro-ecom-infisical) --"
docker compose up -d --wait

echo "-- waiting for the API on :8090 --"
for i in $(seq 1 90); do
  if curl -fsS -m 2 http://localhost:8090/api/status >/dev/null 2>&1; then break; fi
  sleep 1
  [ "$i" = "90" ] && { echo "✗ API didn't come up in 90s. Log: docker compose logs app" >&2; exit 1; }
done
echo "  API is responding"

echo "-- populating the store via REST API --"
node bootstrap.js

echo ""
echo "Stand is ready. Next:"
echo "  node demo.js                          # ✗ doesn't run — no secrets on disk"
echo "  bash run.sh dev  node demo.js          # ✓ same code"
echo "  bash run.sh prod node demo.js          # ✓ different value, same code"
echo "  bash down.sh                           # tear it all down"
echo ""
echo "Reminder: .secrets/ is gitignored — it holds the machine identity's key to the store, not the secrets themselves."
