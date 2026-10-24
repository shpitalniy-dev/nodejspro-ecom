import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { configureApp } from '../../../configure-app.ts';
import { requireEnv } from '../../../utils/require-env.ts';

// demo:auth — login/me/logout mechanics (HW #24, slice 1: access token
// only, no refresh yet — see the plan for what's deferred). Boots the real
// AppModule via the real bootstrap path (NestFactory, same as
// src/index.ts), not a stripped-down stand-in, and listens on an ephemeral
// port rather than the configured PORT so it never collides with an
// already-running `api` container.
//
// Credentials duplicated (not imported) from seed.ts, same precedent
// DEMO_BUYER_EMAIL already set in workers/fulfillment/demo/demo.utils.ts.
const DEMO_BUYER_EMAIL = 'demo-buyer@seed.example';
const DEMO_BUYER_PASSWORD = 'demo-buyer-password-1';

interface LoginResponse {
  accessToken: string;
}

// DataSourceService reads the DB password from a FILE, not an env var —
// deliberately, from HW #15, so a password rotation doesn't need an app
// restart. DB_HOST/DB_PORT/REDIS_*/BROKER_URL all come straight from the
// vault now; DB_PASSWORD is the one piece Infisical can hand over as a
// value but this app's design needs as a file, so this is the one
// unavoidable bridge between the two, not a workaround for something else.
async function writeDbPasswordFile(): Promise<() => Promise<void>> {
  const passwordFile = path.join(
    os.tmpdir(),
    `demo-auth-db-password-${process.pid}`,
  );

  await writeFile(passwordFile, requireEnv('DB_PASSWORD'));
  process.env.DB_PASSWORD_FILE = passwordFile;

  return () => unlink(passwordFile).catch(() => undefined);
}

async function main(): Promise<void> {
  const cleanupPasswordFile = await writeDbPasswordFile();

  try {
    const { AppModule } = await import('../../../app.module.ts');
    // Not `logger: false` — a fatal startup error (e.g. a missing/invalid
    // env var) is exactly what this script needs to surface, not silently
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

    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const login = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: DEMO_BUYER_EMAIL,
          password: DEMO_BUYER_PASSWORD,
        }),
      });

      const loginBody = (await login.json()) as LoginResponse;
      const noToken = await fetch(`${baseUrl}/auth/me`);
      const withToken = await fetch(`${baseUrl}/auth/me`, {
        headers: { authorization: `Bearer ${loginBody.accessToken}` },
      });

      const logout = await fetch(`${baseUrl}/auth/logout`, {
        method: 'POST',
        headers: { authorization: `Bearer ${loginBody.accessToken}` },
      });

      // Same token, reused after logout — this is what actually proves the
      // denylist fired, not just that the route exists.
      const afterLogout = await fetch(`${baseUrl}/auth/me`, {
        headers: { authorization: `Bearer ${loginBody.accessToken}` },
      });

      console.log(
        'demo:auth — login / me / logout (access token only, no refresh yet)',
      );
      console.log(`login=${login.status}`);
      console.log(`no-token=${noToken.status}`);
      console.log(`with-token=${withToken.status}`);
      console.log(`logout=${logout.status}`);
      console.log(`after-logout=${afterLogout.status}`);

      const invariantOk =
        login.status === 200 &&
        noToken.status === 401 &&
        withToken.status === 200 &&
        logout.status === 204 &&
        afterLogout.status === 401;

      if (invariantOk) {
        console.log(
          'invariant check passed — logout denylists the access token immediately',
        );
      } else {
        console.error('invariant check FAILED');
        process.exitCode = 1;
      }
    } finally {
      await app.close();
    }
  } finally {
    await cleanupPasswordFile();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
