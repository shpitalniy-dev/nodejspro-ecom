import 'reflect-metadata';

import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ConfigService } from '@nestjs/config';
import { setTimeout as sleep } from 'node:timers/promises';

import type { Env } from '../../../config/env.schema.ts';
import { S3ClientService } from '../../../services/storage/s3-client.service.ts';
import {
  DEMO_BUYER_EMAIL,
  DEMO_BUYER_PASSWORD,
  type LoginResponse,
  postLogin,
  startDemoApp,
} from '../../auth/demo/demo.utils.ts';

import { cleanupFiles, isPortOpen } from './demo.utils.ts';

interface IntentResponse {
  fileUuid: string;
  key: string;
  uploadUrl: string;
  expiresIn: number;
}

// A real (if trivial — 1x1 transparent) PNG, not arbitrary text — commit()
// verifies the uploaded bytes' magic-bytes signature against the declared
// contentType, so the real upload step needs actual PNG bytes to reach
// commit=200.
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

// Mutates a presigned URL's object key while leaving its signature
// untouched — SigV4 covers the canonical request's path, so this must be
// rejected regardless of which key it originally pointed at.
function tamperKey(uploadUrl: string): string {
  const url = new URL(uploadUrl);

  url.pathname += 'x';

  return url.toString();
}

// demo:upload — presigned intent/commit contract (HW #26, slice 1). Proves
// three things a plain "there's an upload endpoint" can't: bytes bypass our
// API entirely, the server (not the client) controls the object key, and
// the presigned URL's own signature/expiry are real constraints.
async function main(): Promise<void> {
  const app1 = await startDemoApp();

  let current = app1;
  let currentClosed = false;

  let intentFileUuid: string | undefined;
  let intent2FileUuid: string | undefined;

  try {
    const login = await postLogin(
      app1.baseUrl,
      DEMO_BUYER_EMAIL,
      DEMO_BUYER_PASSWORD,
    );
    const { accessToken } = (await login.json()) as LoginResponse;
    const authHeaders = { authorization: `Bearer ${accessToken}` };

    const intentRes = await fetch(`${app1.baseUrl}/uploads/intent`, {
      method: 'POST',
      headers: { ...authHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({
        contentType: 'image/png',
        size: PNG_1X1.length,
        // Deliberately malicious — proves the server never reads this
        // into the object key (see files.service.ts's createIntent()).
        filename: '../../etc/passwd',
      }),
    });
    const intent = (await intentRes.json()) as IntentResponse;
    intentFileUuid = intent.fileUuid;
    const keyFromServer =
      !intent.key.includes('etc/passwd') && !intent.key.includes('..') ? 1 : 0;

    // tampered
    const tampered = await fetch(tamperKey(intent.uploadUrl), {
      method: 'PUT',
      body: Buffer.from('tampered'),
    });

    // expired
    const bucket = app1.app
      .get(ConfigService<Env, true>)
      .get('STORAGE_BUCKET_UPLOADS', { infer: true });
    const expiredUrl = await getSignedUrl(
      app1.app.get(S3ClientService).client,
      new PutObjectCommand({
        Bucket: bucket,
        Key: `uploads/demo-scratch/expiry-check-${Date.now()}.bin`,
      }),
      { expiresIn: 1 },
    );

    await sleep(1500);

    const expiredRes = await fetch(expiredUrl, {
      method: 'PUT',
      body: Buffer.from('too-late'),
    });
    // Garage v2.1.0 rejects an expired SigV4 presigned URL with 400
    // InvalidRequest ("Date is too old"), not AWS/MinIO's 403 AccessDenied.
    const expiredBody = await expiredRes.text();
    const expired =
      expiredRes.status === 400 && /date.*(too old|expired)/i.test(expiredBody)
        ? 403
        : expiredRes.status;

    // commit-without-bytes — intent, never PUT, commit anyway.
    const intent2Res = await fetch(`${app1.baseUrl}/uploads/intent`, {
      method: 'POST',
      headers: { ...authHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({ contentType: 'image/png', size: PNG_1X1.length }),
    });
    const intent2 = (await intent2Res.json()) as IntentResponse;
    intent2FileUuid = intent2.fileUuid;
    const commitWithoutBytes = await fetch(`${app1.baseUrl}/uploads/commit`, {
      method: 'POST',
      headers: { ...authHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({ fileUuid: intent2.fileUuid }),
    });

    // api-alive / put-offline — the headline pair. Shut the app down, then
    // prove the real upload still completes straight against storage.
    await app1.close();
    currentClosed = true;
    const apiAlive = (await isPortOpen(Number(new URL(app1.baseUrl).port)))
      ? 1
      : 0;

    const putOffline = await fetch(intent.uploadUrl, {
      method: 'PUT',
      body: PNG_1X1,
    });

    const app2 = await startDemoApp();
    current = app2;
    currentClosed = false;

    const commitRes = await fetch(`${app2.baseUrl}/uploads/commit`, {
      method: 'POST',
      headers: { ...authHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({ fileUuid: intent.fileUuid }),
    });

    console.log('demo:upload — presigned intent/commit contract');
    console.log(`intent=${intentRes.status}`);
    console.log(`key-from-server=${keyFromServer}`);
    console.log(`api-alive=${apiAlive}`);
    console.log(`put-offline=${putOffline.status}`);
    console.log(`commit=${commitRes.status}`);
    console.log(`commit-without-bytes=${commitWithoutBytes.status}`);
    console.log(`tampered=${tampered.status}`);
    console.log(`expired=${expired}`);

    const is4xx = (status: number): boolean => status >= 400 && status < 500;

    const invariantOk =
      intentRes.status === 200 &&
      keyFromServer === 1 &&
      apiAlive === 0 &&
      putOffline.status === 200 &&
      commitRes.status === 200 &&
      is4xx(commitWithoutBytes.status) &&
      tampered.status === 403 &&
      expired === 403;

    if (invariantOk) {
      console.log(
        'invariant check passed — bytes bypass the API, the key is server-generated, and the presigned URL signature/expiry both hold',
      );
    } else {
      console.error('invariant check FAILED');
      process.exitCode = 1;
    }
  } finally {
    // Best-effort: if neither app is reachable here (an exception landed
    // in the narrow window between closing app1 and app2 existing), skip
    // rather than fail the whole script over cleanup — the real result
    // (invariantOk, exit code) already printed above.
    if (!currentClosed) {
      await cleanupFiles(current.app, [intentFileUuid, intent2FileUuid]);
      await current.close();
    }
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
