#!/usr/bin/env node
// Ensures Garage (HW #26's object storage) is ready to use: a one-node
// cluster layout, the hw26-uploads bucket, and OUR chosen access key
// imported and granted on it. Idempotent — safe to run on every
// `docker compose up` (checks each step's current state first) and run by
// hand.
//
// STORAGE_ACCESS_KEY/STORAGE_SECRET_KEY are INPUTS here, not outputs —
// Garage's admin API has `ImportKey` (POST /v2/ImportKey, body
// {accessKeyId, secretAccessKey, name}) alongside the more commonly-used
// `CreateKey` (which only ever mints a random key). Importing means WE
// choose the value, the same way REFRESH_TOKEN_PEPPER is generated —
// no key ever needs to travel out of Garage into a shared file; it just
// needs to be told to accept the value that's already in .env/Infisical.
//
// Usage: STORAGE_ACCESS_KEY=... STORAGE_SECRET_KEY=... node scripts/garage-init.mjs
// GARAGE_ADMIN_URL defaults to the host-published admin port; the
// garage-init compose service overrides it to the in-network one
// (see docker-compose.yml).
//
// Garage enforces its own key-ID shape — ImportKey 400s on anything else:
// STORAGE_ACCESS_KEY must be "GK" + 12 hex-encoded bytes (24 hex chars).
// STORAGE_SECRET_KEY has no such constraint (any string works).
//
// GARAGE_ADMIN_TOKEN authenticates against the SAME token the `garage`
// container itself was given (GARAGE_ADMIN_TOKEN env var, native to the
// garage binary since v0.8.2 — see garage/garage.toml's own comment on
// why it's not in that committed file).
//
// The lifecycle step (bottom) is the one piece that can't go through the
// admin API: Garage v2.1.0's `UpdateBucket` silently ignores
// `lifecycleRules` (that field's only documented for a later admin API
// version — confirmed empirically against this exact running container,
// not assumed from the docs). The real, working path is the S3-protocol
// PutBucketLifecycleConfiguration call, which is SigV4-signed — hence the
// @aws-sdk/client-s3 import below.
import {
  PutBucketLifecycleConfigurationCommand,
  S3Client,
} from '@aws-sdk/client-s3';

function requireEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(
      `${name} is not set: export it or run through scripts/with-secrets.sh`,
    );
  }

  return value;
}

const ADMIN_URL = process.env.GARAGE_ADMIN_URL ?? 'http://127.0.0.1:6601';
const ADMIN_TOKEN = requireEnv('GARAGE_ADMIN_TOKEN');
const BUCKET_ALIAS = 'hw26-uploads';
const KEY_NAME = 'hw26-key';

const accessKeyId = requireEnv('STORAGE_ACCESS_KEY');
const secretAccessKey = requireEnv('STORAGE_SECRET_KEY');

const log = s => console.log(`  ${s}`);

async function call(method, path, body) {
  const res = await fetch(`${ADMIN_URL}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${ADMIN_TOKEN}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    throw new Error(`${method} ${path} -> ${res.status} ${await res.text()}`);
  }

  return res.status === 204 ? null : res.json();
}

// ─── 1 · cluster layout ─────────────────────────────────────────────────
const status = await call('GET', '/v2/GetClusterStatus');
const node = status.nodes[0];

if (!node) {
  throw new Error('GetClusterStatus returned no nodes');
}

if (!node.role) {
  const layout = await call('GET', '/v2/GetClusterLayout');

  await call('POST', '/v2/UpdateClusterLayout', {
    roles: [{ id: node.id, zone: 'hw26', capacity: 1073741824, tags: [] }],
  });
  await call('POST', '/v2/ApplyClusterLayout', { version: layout.version + 1 });
  log(`node ${node.id} assigned zone hw26, capacity 1G`);
} else {
  log(`node ${node.id} already has a role`);
}

// Layout application finishes asynchronously — any call fails until the
// cluster finishes handing out partitions.
for (let attempt = 1; ; attempt += 1) {
  try {
    await call('GET', '/v2/ListBuckets');
    log(`layout ready (attempt ${attempt})`);
    break;
  } catch (error) {
    if (attempt >= 60) throw error;
    await new Promise(r => setTimeout(r, 500));
  }
}

// ─── 2 · bucket ─────────────────────────────────────────────────────────
const buckets = await call('GET', '/v2/ListBuckets');
let bucket = buckets.find(b => b.globalAliases.includes(BUCKET_ALIAS));

if (bucket) {
  log(`bucket ${BUCKET_ALIAS} already exists`);
} else {
  bucket = await call('POST', '/v2/CreateBucket', {
    globalAlias: BUCKET_ALIAS,
  });
  log(`bucket ${BUCKET_ALIAS} created`);
}

// ─── 3 · our chosen access key ──────────────────────────────────────────
const keyExists = await fetch(
  `${ADMIN_URL}/v2/GetKeyInfo?id=${encodeURIComponent(accessKeyId)}`,
  { headers: { authorization: `Bearer ${ADMIN_TOKEN}` } },
).then(res => res.ok);

if (keyExists) {
  log(`key ${KEY_NAME} already imported`);
} else {
  await call('POST', '/v2/ImportKey', {
    accessKeyId,
    secretAccessKey,
    name: KEY_NAME,
  });
  log(`key ${KEY_NAME} imported`);
}

// ─── 4 · grant ───────────────────────────────────────────────────────────
await call('POST', '/v2/AllowBucketKey', {
  bucketId: bucket.id,
  accessKeyId,
  permissions: { read: true, write: true, owner: true },
});
log(`key ${KEY_NAME} granted read/write/owner on ${BUCKET_ALIAS}`);

// ─── 5 · lifecycle: two rules, two different kinds of orphan ────────────
// 1. Incomplete multipart uploads (a client started one and never called
//    Complete/Abort) are billed forever and invisible in a plain object
//    listing — HeadObject 404s on them the same as a key that was never
//    used, and Expiration doesn't touch them either (different action).
//    Bucket-wide, independent of which prefix they land under.
// 2. Objects under PENDING_PREFIX (see files.service.ts's own comment) —
//    PUT to, but commit() never called, so never moved to their real
//    uploads/ key. A client that abandons the upload flow after PUTting
//    bytes (closes the tab, loses the network) leaves exactly this: real
//    bytes, no DB row ever reaching 'completed'. This rule is what
//    actually cleans that up, independent of any app code running.
// Declarative — always set, not checked first, same reasoning as
// AllowBucketKey above.
const s3 = new S3Client({
  endpoint: process.env.STORAGE_ENDPOINT ?? 'http://127.0.0.1:6600',
  region: 'us-east-1',
  forcePathStyle: true,
  credentials: { accessKeyId, secretAccessKey },
});

await s3.send(
  new PutBucketLifecycleConfigurationCommand({
    Bucket: BUCKET_ALIAS,
    LifecycleConfiguration: {
      Rules: [
        {
          ID: 'abort-incomplete-mpu',
          Status: 'Enabled',
          Filter: {},
          AbortIncompleteMultipartUpload: { DaysAfterInitiation: 7 },
        },
        {
          ID: 'expire-abandoned-pending',
          Status: 'Enabled',
          Filter: { Prefix: 'pending/' },
          Expiration: { Days: 1 },
        },
      ],
    },
  }),
);
log(
  `lifecycle rules set on ${BUCKET_ALIAS}: abort incomplete multipart uploads after 7 days, expire abandoned pending/ uploads after 1 day`,
);
