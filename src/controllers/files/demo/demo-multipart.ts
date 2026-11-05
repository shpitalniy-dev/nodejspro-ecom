import 'reflect-metadata';

import { HeadObjectCommand } from '@aws-sdk/client-s3';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';

import type { Env } from '../../../config/env.schema.ts';
import { S3ClientService } from '../../../services/storage/s3-client.service.ts';
import {
  DEMO_BUYER_EMAIL,
  DEMO_BUYER_PASSWORD,
  type LoginResponse,
  postLogin,
  startDemoApp,
} from '../../auth/demo/demo.utils.ts';
import { MIN_PART_SIZE_BYTES } from '../files.utils.ts';

import { cleanupFiles } from './demo.utils.ts';

interface IntentResponse {
  fileUuid: string;
  key: string;
  uploadId: string;
  partSize: number;
  parts: { partNumber: number; uploadUrl: string }[];
  expiresIn: number;
}

interface ResumeResponse {
  fileUuid: string;
  key: string;
  uploadId: string;
  partSize: number;
  parts: { partNumber: number; uploadUrl: string }[];
}

// Guarantees partCount === 3 via files.utils.ts's own computePartSize()
// formula (5 MiB floor dominates at this size) — no duplicated math.
const TOTAL_SIZE = 3 * MIN_PART_SIZE_BYTES;

// commit() magic-bytes-checks the completed object regardless of upload
// path (single-PUT or multipart) — so part 1 needs a real PNG signature
// in its first 8 bytes. The rest of the buffer stays random padding; the
// check only ever reads the first 12 bytes.
const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

async function putPart(uploadUrl: string, body: Buffer): Promise<Response> {
  return fetch(uploadUrl, { method: 'PUT', body });
}

// demo:multipart — resumable multipart upload (HW #26, slice 2). Proves
// resumption, not "supports big files": a second process, after a crash
// with one of three parts missing, uploads only that one part — and the
// object is unreadable (HeadObject 404) until Complete, even with two
// parts already physically on the server.
async function main(): Promise<void> {
  const app1 = await startDemoApp();

  let current = app1;
  let currentClosed = false;
  let fileUuid: string | undefined;

  try {
    const login = await postLogin(
      app1.baseUrl,
      DEMO_BUYER_EMAIL,
      DEMO_BUYER_PASSWORD,
    );
    const { accessToken } = (await login.json()) as LoginResponse;
    const authHeaders = { authorization: `Bearer ${accessToken}` };

    const buffer = randomBytes(TOTAL_SIZE);
    PNG_SIGNATURE.copy(buffer, 0);

    const intentRes = await fetch(`${app1.baseUrl}/uploads/intent`, {
      method: 'POST',
      headers: { ...authHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({ contentType: 'image/png', size: TOTAL_SIZE }),
    });
    const intent = (await intentRes.json()) as IntentResponse;
    fileUuid = intent.fileUuid;
    const { partSize, parts } = intent;

    await putPart(parts[0].uploadUrl, buffer.subarray(0, partSize));
    await putPart(parts[1].uploadUrl, buffer.subarray(partSize, 2 * partSize));
    // Part 3 deliberately never sent — this is "the drop".

    const bucket = app1.app
      .get(ConfigService<Env, true>)
      .get('STORAGE_BUCKET_UPLOADS', { infer: true });

    let headBeforeComplete = 200;

    try {
      await app1.app
        .get(S3ClientService)
        .client.send(
          new HeadObjectCommand({ Bucket: bucket, Key: intent.key }),
        );
    } catch (error) {
      headBeforeComplete =
        (error as { $metadata?: { httpStatusCode?: number } }).$metadata
          ?.httpStatusCode ?? 404;
    }

    await app1.close();
    currentClosed = true;

    const app2 = await startDemoApp();
    current = app2;
    currentClosed = false;

    const resumeRes = await fetch(`${app2.baseUrl}/uploads/resume`, {
      method: 'POST',
      headers: { ...authHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({ fileUuid }),
    });
    const resume = (await resumeRes.json()) as ResumeResponse;
    const resumedParts = resume.parts.length;

    await putPart(resume.parts[0].uploadUrl, buffer.subarray(2 * partSize));

    const commitRes = await fetch(`${app2.baseUrl}/uploads/commit`, {
      method: 'POST',
      headers: { ...authHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({ fileUuid }),
    });
    const complete = commitRes.status;

    const head = await app2.app
      .get(S3ClientService)
      .client.send(new HeadObjectCommand({ Bucket: bucket, Key: intent.key }));
    const sizeMatch = head.ContentLength === TOTAL_SIZE ? 1 : 0;
    const etag = (head.ETag ?? '').replaceAll('"', '');
    const etagMultipart = /-\d+$/.test(etag) ? 1 : 0;

    console.log('demo:multipart — resumable multipart upload contract');
    console.log(`head-before-complete=${headBeforeComplete}`);
    console.log(`resumed-parts=${resumedParts}`);
    console.log(`complete=${complete}`);
    console.log(`size-match=${sizeMatch}`);
    console.log(`etag-multipart=${etagMultipart}`);

    const invariantOk =
      headBeforeComplete === 404 &&
      resumedParts === 1 &&
      complete === 200 &&
      sizeMatch === 1 &&
      etagMultipart === 1;

    if (invariantOk) {
      console.log(
        'invariant check passed — the object is unreadable before Complete, resumption uploads only the missing part, and the final size/ETag both check out',
      );
    } else {
      console.error('invariant check FAILED');
      process.exitCode = 1;
    }
  } finally {
    if (!currentClosed) {
      await cleanupFiles(current.app, [fileUuid]);
      await current.close();
    }
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
