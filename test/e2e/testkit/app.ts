import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { configureApp } from '../../../src/configure-app.ts';
import type { TestRedis } from '../../integration/testkit/redis-container.ts';

// Points the app at the SAME testcontainer test/integration's own testkit
// already started, through the exact env vars DatabaseService/DataSourceService
// read in production (DB_HOST/PORT/NAME/USER/DB_PASSWORD_FILE) — not DB_URL,
// which the running app never reads (see docker-compose.yml's own comment
// on that). No provider overrides: Test.createTestingModule({ imports:
// [AppModule] }) is the real DI graph, configureApp() is the real bootstrap
// config — this exercises the same app prod runs, just pointed at a
// container instead of pgbouncer.
//
// AppModule is imported dynamically, INSIDE this function, after the env
// vars below are set — not as a static top-level import. @Module()'s
// ConfigModule.forRoot() call reads process.env the moment app.module.ts is
// first evaluated, and static imports are hoisted ahead of a function's own
// body: a static import here would snapshot the repo's real .env (DB_HOST=
// pgbouncer) before this function ever got a chance to override it.
export async function startTestApp(
  container: StartedPostgreSqlContainer,
  redis: TestRedis,
): Promise<INestApplication> {
  process.env.PORT = '3000'; // never bound — app.listen() is not called below, just satisfies schema validation (min 1)
  process.env.DB_URL = container.getConnectionUri(); // satisfies schema validation only, never read
  process.env.DB_HOST = container.getHost();
  process.env.DB_PORT = String(container.getPort());
  process.env.DB_NAME = container.getDatabase();
  process.env.DB_USER = container.getUsername();
  // RabbitMQ (HW #19): satisfies schema validation only. RabbitMqService is
  // lazy and nothing calls it yet, so e2e never opens a connection.
  process.env.BROKER_URL = 'amqp://unused:unused@127.0.0.1:5672';
  // Unlike BROKER_URL above, these ARE read live: GET /products goes
  // through both CacheAsideService and RateLimitGuard. A docker-compose
  // internal hostname (redis-cache/redis-queue) only resolves inside the
  // compose network — never on the host this test runs on, and never in
  // CI — so this needs a real, reachable container, not a placeholder.
  process.env.REDIS_URL = redis.url;
  process.env.REDIS_QUEUE_URL = redis.url;

  // JwtKeysService decodes these in its constructor, during module
  // compile below — not lazily on first login — so they must be a real
  // ES256 keypair, not a placeholder string (HW #24). One-off per test
  // run, same generation the README's own "Generating a dev key pair"
  // documents for a human.
  const { privateKey, publicKey } = generateKeyPairSync('ec', {
    namedCurve: 'P-256',
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  process.env.JWT_KID = 'e2e-test-kid';
  process.env.JWT_PRIVATE_KEY = Buffer.from(privateKey).toString('base64');
  process.env.JWT_PUBLIC_KEY = Buffer.from(publicKey).toString('base64');
  process.env.REFRESH_TOKEN_PEPPER = randomBytes(32).toString('base64');

  process.env.STORAGE_ENDPOINT = 'http://127.0.0.1:6600';
  process.env.STORAGE_BUCKET_UPLOADS = 'hw26-uploads';
  process.env.STORAGE_BUCKET_ASSETS = 'hw26-assets';
  process.env.STORAGE_ACCESS_KEY = `GK${randomBytes(12).toString('hex')}`;
  process.env.STORAGE_SECRET_KEY = randomBytes(32).toString('hex');

  const passwordFile = path.join(os.tmpdir(), `e2e-db-password-${process.pid}`);

  await writeFile(passwordFile, container.getPassword());
  process.env.DB_PASSWORD_FILE = passwordFile;

  const { AppModule } = await import('../../../src/app.module.ts');

  // e2e never talks to a broker: order creation writes to the outbox table
  // and returns, with nothing in the request path calling RabbitMqService
  // directly. Real publishing is covered by the consumer/publisher/relay
  // demos.
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>({
    bodyParser: false,
  });

  configureApp(app);
  await app.init();

  return app;
}
