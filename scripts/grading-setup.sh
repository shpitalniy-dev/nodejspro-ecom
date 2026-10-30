#!/usr/bin/env bash
export DB_URL=postgresql://admin:admin-bootstrap-password@127.0.0.1:6432/ecom
export BROKER_URL=amqp://app:app@127.0.0.1:5672
export REDIS_URL=redis://127.0.0.1:6379
export REDIS_QUEUE_URL=redis://127.0.0.1:6380
export SKIP_VAULT=1

# one-time ES256 pair for this run — see Authentication | HW #24's own
# "Generating a dev key pair" for what each line does
node -e "
const { generateKeyPairSync } = require('node:crypto');
const k = generateKeyPairSync('ec', {
  namedCurve: 'P-256',
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
require('node:fs').writeFileSync('/tmp/jwt-priv.b64', Buffer.from(k.privateKey).toString('base64'));
require('node:fs').writeFileSync('/tmp/jwt-pub.b64', Buffer.from(k.publicKey).toString('base64'));
"
export JWT_KID=grader
export JWT_PRIVATE_KEY="$(cat /tmp/jwt-priv.b64)"
export JWT_PUBLIC_KEY="$(cat /tmp/jwt-pub.b64)"
export REFRESH_TOKEN_PEPPER="$(node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))")"

# docker-compose.yml passes these through to `api` by bare-name passthrough
# (see its own comment) — it only reads them if they're already exported
# here, so `up` has to run after every export above, not before.
docker compose up -d --wait
