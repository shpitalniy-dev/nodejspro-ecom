#!/bin/sh
set -u

for _ in $(seq 1 60); do
  [ -s /shared-secrets/db-password ] && break
  sleep 1
done

if [ -s /shared-secrets/db-password ]; then
  /etc/infisical/on-change.sh || echo "reconcile: startup on-change.sh check failed"
else
  echo "reconcile: /shared-secrets/db-password never appeared within 60s, skipping"
fi
