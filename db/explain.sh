#!/usr/bin/env bash
# Runs EXPLAIN (ANALYZE, BUFFERS) for all three queries. Same script, run
# twice:
#   1. Right after db/schema.sql + db/seed.sql, before db/indexes.sql
#      exists — every query should show a Seq Scan. Paste into the
#      "Before" section of each query in db/OPTIMIZATIONS.md.
#   2. After applying db/indexes.sql and running `psql -c "ANALYZE;"` —
#      no Seq Scan should be left. Paste into "After".
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

for q in db/queries/q*.sql; do
  echo "=== $q ==="
  docker compose exec -T postgres psql -U admin -d ecom \
    -c "EXPLAIN (ANALYZE, BUFFERS) $(cat "$q")"
  echo
done
