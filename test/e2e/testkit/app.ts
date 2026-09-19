import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { configureApp } from '../../../src/configure-app.ts';

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
): Promise<INestApplication> {
  process.env.PORT = '3000'; // never bound — app.listen() is not called below, just satisfies schema validation (min 1)
  process.env.DB_URL = container.getConnectionUri(); // satisfies schema validation only, never read
  process.env.DB_HOST = container.getHost();
  process.env.DB_PORT = String(container.getPort());
  process.env.DB_NAME = container.getDatabase();
  process.env.DB_USER = container.getUsername();

  const passwordFile = path.join(os.tmpdir(), `e2e-db-password-${process.pid}`);

  await writeFile(passwordFile, container.getPassword());
  process.env.DB_PASSWORD_FILE = passwordFile;

  const { AppModule } = await import('../../../src/app.module.ts');

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
