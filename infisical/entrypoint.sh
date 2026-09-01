#!/bin/sh
set -eu

rm -f /shared-secrets/demo-secret /shared-secrets/db-password

PROJECT_ID="$(cat /etc/infisical/configs/project_id)"

mkdir -p /tmp/rendered
sed -e "s/__ENV__/${INFISICAL_ENV}/g" -e "s/__PROJECT_ID__/${PROJECT_ID}/g" \
  /etc/infisical/templates/template.txt > /tmp/rendered/template.txt
sed -e "s/__ENV__/${INFISICAL_ENV}/g" -e "s/__PROJECT_ID__/${PROJECT_ID}/g" \
  /etc/infisical/templates/db-password-template.txt > /tmp/rendered/db-password-template.txt

/etc/infisical/reconcile.sh &

exec infisical agent --config=/etc/infisical/agent-config.yaml
