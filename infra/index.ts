import * as k8s from '@pulumi/kubernetes';

import { WebService } from './components/web-service';

// Validate config BEFORE any cluster interaction — a missing var must fail
// here, by name, not three resources deep into a half-applied `pulumi up`.
// This is the entire point of criterion 5's "remove one var, expect the
// preview to name it" check.
const REQUIRED = [
  'JWT_KID',
  'JWT_PRIVATE_KEY',
  'JWT_PUBLIC_KEY',
  'REFRESH_TOKEN_PEPPER',
] as const;

const secretValues: Record<string, string> = {};

for (const name of REQUIRED) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`missing required env var: ${name}`);
  }

  secretValues[name] = value;
}

const ns = new k8s.core.v1.Namespace('nodejspro-ecom', {
  metadata: { name: 'nodejspro-ecom' },
});

// `data` (pre-base64'd), never `stringData` — stringData is write-only in
// the K8s API, so the provider would see a perpetual diff and `pulumi up`
// could never report `unchanged` twice in a row.
const appSecret = new k8s.core.v1.Secret('app-secret', {
  metadata: { namespace: ns.metadata.name, name: 'app-secret' },
  type: 'Opaque',
  data: Object.fromEntries(
    Object.entries(secretValues).map(([name, value]) => [
      name,
      Buffer.from(value).toString('base64'),
    ]),
  ),
});

// Overridable only by demo/demo-rollout.mjs, which drives both a
// "broken" (hardened:false) and a hardened deploy to prove zero-downtime
// actually depends on the probes/strategy, not luck. `npm run up` with no
// overrides behaves exactly as before.
const hardened = process.env.HARDENED !== 'false';

new WebService('nodejspro-ecom-api', {
  namespace: ns.metadata.name,
  image: 'nodejspro-ecom-api:k8s',
  replicas: 2,
  secretName: appSecret.metadata.name,
  hardened,
  // Plain placeholders, not secrets: DataSourceService, RabbitMqService and
  // RedisConnectionService are all deliberately lazy (see their own
  // comments) and GET /health never touches any of them, so nothing on
  // this pod's actual request path ever dereferences these values — they
  // exist only to satisfy env.schema.ts's Zod *shape* at boot.
  env: {
    PORT: '3000',
    DB_URL: 'postgresql://demo:demo@localhost:5432/ecom',
    BROKER_URL: 'amqp://demo:demo@localhost:5672',
    REDIS_URL: 'redis://localhost:6379',
    REDIS_QUEUE_URL: 'redis://localhost:6380',
    STORAGE_ENDPOINT: 'http://localhost:9000',
    STORAGE_ACCESS_KEY: 'demo',
    STORAGE_SECRET_KEY: 'demo',
    STORAGE_BUCKET_UPLOADS: 'uploads',
    STORAGE_BUCKET_ASSETS: 'assets',
    // Deployment-lifecycle knobs, not app config — read directly from
    // process.env in src/index.ts and ReadinessService, not env.schema.ts.
    DRAIN_MS: '5000',
    WARMUP_MS: process.env.WARMUP_MS ?? '0',
    REV: process.env.REV ?? '1',
  },
});
