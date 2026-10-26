import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { configureApp } from '../../../configure-app.ts';
import { requireEnv } from '../../../utils/require-env.ts';

// Shared by demo-auth.ts, demo-reuse.ts, and demo-rbac.ts — all boot the
// real app the same way and need the same cookie/env/login plumbing
// around it.
export const DEMO_BUYER_EMAIL = 'demo-buyer@seed.example';
export const DEMO_BUYER_PASSWORD = 'demo-buyer-password-1';

// demo-rbac.ts's admin login — see seed.ts's own comment on why
// alice@seed.example (role 'admin') gets a real password now too.
export const DEMO_ADMIN_EMAIL = 'alice@seed.example';
export const DEMO_ADMIN_PASSWORD = 'demo-admin-password-1';

export interface LoginResponse {
  accessToken: string;
}

// Named postLogin, not login — every caller already has a local `login`
// (the response itself, used for its .status and/or passed to
// extractCookie()), and importing a same-named function would shadow it.
export function postLogin(
  baseUrl: string,
  email: string,
  password: string,
): Promise<Response> {
  return fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
}

// Node's fetch has no browser-style cookie jar — this pulls just the
// `name=value` pair back out of a Set-Cookie header so it can be resent as
// a plain Cookie header on the next call. Only one cookie is ever set per
// response here, so the first Set-Cookie line is the whole story.
export function extractCookie(res: Response): string {
  const [setCookie] = res.headers.getSetCookie();

  if (!setCookie) {
    throw new Error('expected a __Host-rt Set-Cookie header');
  }

  const [pair] = setCookie.split(';');

  return pair ?? setCookie;
}

// DataSourceService connects via DB_HOST/DB_PORT/DB_USER/DB_PASSWORD_FILE,
// not DB_URL (DB_URL is cosmetic — see env.schema.ts's own comment). Those
// default to docker-internal values (pgbouncer, /run/secrets/db_password)
// that don't resolve host-side, and the grading Setup snippet only exports
// DB_URL — so this derives the discrete vars from it, same technique
// test/e2e/testkit/app.ts uses (there: from a testcontainer; here: from the
// one connection string every other host-side script already has).
async function deriveDbEnvFromUrl(): Promise<() => Promise<void>> {
  const dbUrl = new URL(requireEnv('DB_URL'));

  process.env.DB_HOST = dbUrl.hostname;
  process.env.DB_PORT = dbUrl.port;
  process.env.DB_NAME = dbUrl.pathname.slice(1);
  process.env.DB_USER = decodeURIComponent(dbUrl.username);

  const passwordFile = path.join(
    os.tmpdir(),
    `auth-demo-db-password-${process.pid}`,
  );

  await writeFile(passwordFile, decodeURIComponent(dbUrl.password));
  process.env.DB_PASSWORD_FILE = passwordFile;

  return () => unlink(passwordFile).catch(() => undefined);
}

// Boots the real AppModule via the real bootstrap path (NestFactory, same
// as src/index.ts), not a stripped-down stand-in, and listens on an
// ephemeral port rather than the configured PORT so it never collides with
// an already-running `api` container. Must derive the DB env and import
// AppModule in that order — ConfigModule.forRoot({ validate }) reads
// process.env at import time, and a static top-level import would snapshot
// the environment before deriveDbEnvFromUrl() ever got a chance to set it.
export async function startDemoApp(): Promise<{
  baseUrl: string;
  // Exposed for demo-rbac.ts, which needs to seed an order directly
  // (app.get(DataSourceService)) rather than through POST /orders —
  // see that demo's own comment on why.
  app: INestApplication;
  close: () => Promise<void>;
}> {
  const cleanupPasswordFile = await deriveDbEnvFromUrl();

  try {
    const { AppModule } = await import('../../../app.module.ts');
    // Not `logger: false` — a fatal startup error (e.g. a missing/invalid
    // env var) is exactly what these scripts need to surface, not silently
    // swallow. 'log' level (route mapping etc.) is dropped to keep the
    // required key=value lines easy to read; errors/warnings stay.
    const app = await NestFactory.create<NestExpressApplication>(AppModule, {
      bodyParser: false,
      logger: ['error', 'warn'],
    });

    configureApp(app);
    await app.listen(0);

    const address = app.getHttpServer().address();

    if (typeof address !== 'object' || address === null) {
      throw new Error('expected app.listen(0) to bind a TCP port');
    }

    return {
      baseUrl: `http://127.0.0.1:${address.port}`,
      app,
      close: async () => {
        await app.close();
        await cleanupPasswordFile();
      },
    };
  } catch (error) {
    // Startup failed before a `close()` could ever be handed back — clean
    // up the password file here instead of leaving it orphaned.
    await cleanupPasswordFile();
    throw error;
  }
}
