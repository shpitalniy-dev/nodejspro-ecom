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

# HW #26 — object storage (Garage). ACCESS_KEY/SECRET_KEY are ours to
# choose (ImportKey, not CreateKey — see scripts/garage-init.mjs), same
# throwaway-per-run shape as JWT_PRIVATE_KEY/REFRESH_TOKEN_PEPPER above.
export STORAGE_ENDPOINT=http://127.0.0.1:6600
export STORAGE_BUCKET_UPLOADS=hw26-uploads
export STORAGE_BUCKET_ASSETS=hw26-assets
# Garage enforces the key-ID shape: GK + 12 hex-encoded bytes.
export STORAGE_ACCESS_KEY="GK$(node -e "console.log(require('node:crypto').randomBytes(12).toString('hex'))")"
export STORAGE_SECRET_KEY="$(node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))")"
# Read natively by the garage binary itself, not this project's code — see
# garage/garage.toml's own comment on why they're not in that committed file.
export GARAGE_RPC_SECRET="$(node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))")"
export GARAGE_ADMIN_TOKEN="$(node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))")"

# docker-compose.yml passes these through to `api` by bare-name passthrough
# (see its own comment) — it only reads them if they're already exported
# here, so `up` has to run after every export above, not before.
docker compose up -d --wait
